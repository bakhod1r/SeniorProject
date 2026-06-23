# Strings in Go — Middle Level

## 1. Introduction

At the middle level, strings go beyond basic operations. You understand the internal representation, work confidently with the `strings` and `unicode/utf8` packages, handle encoding edge cases, and make informed performance decisions. This level covers byte/rune duality deeply, string interning, builder internals, and comparisons with other languages.

---

## 2. Prerequisites

- All junior-level string knowledge
- Understanding of Go slices and their headers
- Familiarity with Go interfaces
- Basic knowledge of UTF-8 encoding
- Experience with Go benchmarks (`testing.B`)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **string interning** | Reusing the same memory for identical strings |
| **unsafe string** | Using `unsafe.String` / `unsafe.SliceData` for zero-copy conversion |
| **strings.Reader** | An `io.Reader` backed by a string |
| **strings.Replacer** | Multi-pattern replacement, more efficient than chained Replace |
| **utf8.ValidString** | Checks whether a string contains valid UTF-8 |
| **RuneError** | `utf8.RuneError` (U+FFFD) — replacement character for invalid UTF-8 |
| **string intern pool** | Compiler-level optimization for constant strings |
| **byte slice header** | ptr, len, cap — the three fields of a slice |
| **string header** | ptr, len — the two fields of a string |
| **strings.Clone** | Go 1.20+ function to make an independent copy of a string |

---

## 4. Core Concepts

### 4.1 String Header Internals

```go
import (
    "fmt"
    "reflect"
    "unsafe"
)

s := "Hello"
hdr := (*reflect.StringHeader)(unsafe.Pointer(&s))
fmt.Printf("ptr=%x, len=%d\n", hdr.Data, hdr.Len)
```

### 4.2 The strings Package in Depth

```go
import "strings"

// strings.Replacer — efficient multi-pattern replacement (one pass)
r := strings.NewReplacer(
    "<", "&lt;",
    ">", "&gt;",
    "&", "&amp;",
)
safe := r.Replace("<div>&</div>")
fmt.Println(safe) // &lt;div&gt;&amp;&lt;/div&gt;

// strings.Map — transform each rune
rot13 := strings.Map(func(r rune) rune {
    switch {
    case r >= 'a' && r <= 'z':
        return 'a' + (r-'a'+13)%26
    case r >= 'A' && r <= 'Z':
        return 'A' + (r-'A'+13)%26
    }
    return r
}, "Hello, World!")
fmt.Println(rot13) // Uryyb, Jbeyq!

// strings.IndexFunc — find position by character property
i := strings.IndexFunc("Hello123", func(r rune) bool {
    return r >= '0' && r <= '9'
})
fmt.Println(i) // 5

// strings.FieldsFunc — split by custom predicate
fields := strings.FieldsFunc("one,two;;three", func(r rune) bool {
    return r == ',' || r == ';'
})
fmt.Println(fields) // [one two three]
```

### 4.3 unicode/utf8 Package

```go
import "unicode/utf8"

s := "Hello, World"
fmt.Println(utf8.RuneCountInString(s))    // 12
fmt.Println(utf8.ValidString(s))          // true
fmt.Println(utf8.ValidString("\xff\xfe")) // false

// Decode one rune at a time without range
b := []byte("Hi!")
for len(b) > 0 {
    r, size := utf8.DecodeRune(b)
    fmt.Printf("%c (%d bytes)\n", r, size)
    b = b[size:]
}
```

### 4.4 Zero-Copy String/Byte Conversion (unsafe)

```go
import "unsafe"

// Zero-copy string -> []byte (READ ONLY — never modify!)
func unsafeStringToBytes(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}

// Zero-copy []byte -> string
func unsafeBytesToString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

---

## 5. Real-World Analogies

**strings.Replacer as Find-and-Replace Macro:**
Like a word processor's Replace All feature running multiple replacements in one pass through the document rather than scanning separately for each pattern.

**strings.Builder as a Whiteboard:**
A whiteboard lets you write incrementally. When done, you take a photo (call `.String()`). The Builder is the whiteboard; `.String()` is the photo.

**strings.Clone as a Photocopier:**
When you have a small excerpt (substring) that references a huge document's backing pages, `strings.Clone` photocopies just the excerpt so the huge document can be discarded.

---

## 6. Mental Models

### Model 1: Sharing vs Copying

```
s1 := "Hello, World"
s2 := s1[0:5]                    // s2 shares s1's backing bytes — no copy
s3 := strings.Clone(s1[0:5])    // s3 has its own copy — s1 can be GC'd
```

### Model 2: Builder Amortized Growth

```
Write 1 byte: cap=1
Write 1 byte: cap=2
Write 1 byte: cap=4
Write 1 byte: cap=8
...doubling until sufficient
```

### Model 3: UTF-8 State Machine

Valid UTF-8 can be decoded one byte at a time following a deterministic state machine. Go's `utf8` package implements this without allocations.

---

## 7. Pros and Cons

### Pros

- Zero-copy substring slicing via shared backing array
- `strings.Replacer` is faster than chained `strings.Replace` calls
- `strings.Reader` implements `io.Reader` without allocating string data
- Constant strings are deduplicated by the linker
- `strings.Builder` has zero allocation until first write

### Cons

- Substring slicing can keep a large backing array alive (memory leak)
- No built-in rope or persistent string data structure
- `strings.Builder` cannot be copied after first use (causes panic)
- UTF-8 validation on every rune decode has a cost in hot paths

---

## 8. Use Cases

- **Parser/Lexer** — tokenizing source code using `strings.IndexAny`, `strings.Cut`
- **HTTP middleware** — header normalization with `strings.ToLower`
- **Template engines** — efficient rendering with `strings.Builder`
- **Config parsers** — key=value splitting with `strings.Cut`
- **Log processors** — structured field extraction
- **Protocol encoding** — Base64, hex combined with string conversion

---

## 9. Code Examples

### Example 1: Efficient Multi-Line String Building

```go
package main

import (
    "fmt"
    "strings"
)

func buildReport(items []string) string {
    var sb strings.Builder
    sb.Grow(len(items) * 32) // pre-allocate estimated capacity
    sb.WriteString("Report:\n")
    for i, item := range items {
        fmt.Fprintf(&sb, "  %d. %s\n", i+1, item)
    }
    return sb.String()
}

func main() {
    items := []string{"Deploy app", "Run tests", "Send email"}
    fmt.Println(buildReport(items))
}
```

### Example 2: Custom Rune-Level Processing

```go
package main

import (
    "fmt"
    "strings"
    "unicode"
)

// RemoveNonPrintable strips non-printable characters
func RemoveNonPrintable(s string) string {
    return strings.Map(func(r rune) rune {
        if unicode.IsPrint(r) {
            return r
        }
        return -1 // -1 means drop this rune
    }, s)
}

func main() {
    fmt.Println(RemoveNonPrintable("Hello\x00World\x01!")) // HelloWorld!
}
```

### Example 3: strings.Reader as io.Reader

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func processReader(r io.Reader) string {
    data, _ := io.ReadAll(r)
    return string(data)
}

func main() {
    r := strings.NewReader("Hello, Go!")
    fmt.Println(processReader(r)) // Hello, Go!
    fmt.Println(r.Len())          // 0 — fully consumed
}
```

---

## 10. Coding Patterns

### Pattern 1: Pre-grow Builder

```go
func joinWithSep(items []string, sep string) string {
    if len(items) == 0 {
        return ""
    }
    total := len(sep) * (len(items) - 1)
    for _, s := range items {
        total += len(s)
    }
    var sb strings.Builder
    sb.Grow(total)
    sb.WriteString(items[0])
    for _, s := range items[1:] {
        sb.WriteString(sep)
        sb.WriteString(s)
    }
    return sb.String()
}
```

### Pattern 2: Avoid Substring Memory Leak

```go
// LEAK: small holds reference to large backing array
func badSubstring(big string) string {
    return big[:10]
}

// SAFE: independent copy (Go 1.20+)
func safeSubstring(big string) string {
    return strings.Clone(big[:10])
}
```

### Pattern 3: Validate and Sanitize Input

```go
func sanitize(input string) (string, error) {
    input = strings.TrimSpace(input)
    if !utf8.ValidString(input) {
        return "", fmt.Errorf("invalid UTF-8 input")
    }
    if len(input) > 1024 {
        return "", fmt.Errorf("input too long: %d bytes", len(input))
    }
    return input, nil
}
```

---

## 11. Clean Code

- Use `sb.Grow(n)` to pre-allocate when you know approximate output size
- Use `strings.Clone` (Go 1.20+) to break substring backing array references
- Use `strings.NewReplacer` for HTML/text escaping instead of chained Replace
- Extract repeated string manipulation into named helper functions
- Document whether a function requires valid UTF-8 input

---

## 12. Product Use / Feature

- **Search indexing** — tokenization with `strings.Fields` and `strings.FieldsFunc`
- **Email parsing** — local part and domain splitting with `strings.Cut`
- **HTML sanitization** — entity escaping with `strings.NewReplacer`
- **CSV export** — row building with `strings.Builder`
- **Markdown rendering** — heading detection with `strings.HasPrefix(line, "#")`

---

## 13. Error Handling

```go
// Validate UTF-8 on all external sources
func processUserText(text string) error {
    if !utf8.ValidString(text) {
        return fmt.Errorf("invalid UTF-8 in input")
    }
    return nil
}

// strconv errors are structured
n, err := strconv.ParseInt("99999999999999999999999", 10, 64)
if err != nil {
    var numErr *strconv.NumError
    if errors.As(err, &numErr) {
        fmt.Println("Func:", numErr.Func)
        fmt.Println("Input:", numErr.Num)
    }
}
```

---

## 14. Security

- **Constant-time comparison** for tokens:
```go
import "crypto/subtle"
if subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 {
    return errors.New("invalid token")
}
```
- **Length limits** — always cap user strings before processing
- **UTF-8 validation** — call `utf8.ValidString` on external input
- **Unicode normalization** — different code point sequences can represent the same character; use `golang.org/x/text/unicode/norm` to normalize before comparison

---

## 15. Performance Tips

```go
// Benchmark: + vs Builder
func BenchmarkConcat(b *testing.B) {
    words := []string{"a", "b", "c", "d", "e"}
    b.Run("plus", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            s := ""
            for _, w := range words {
                s += w
            }
            _ = s
        }
    })
    b.Run("builder", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            var sb strings.Builder
            for _, w := range words {
                sb.WriteString(w)
            }
            _ = sb.String()
        }
    })
}
// Typical: builder 3-5x faster for 5+ items
```

---

## 16. Metrics

- Use `go test -bench=. -benchmem` to measure allocations per operation
- Watch `strings.Builder.Cap()` to understand growth patterns
- Profile with `pprof` to identify hot string allocation sites
- Track `allocs/op` in string-heavy code paths

---

## 17. Best Practices

1. Call `sb.Grow(estimated)` before a loop to avoid mid-loop reallocations
2. Use `strings.Clone` to prevent substring memory leaks
3. Use `strings.NewReplacer` for multiple replacements (single pass)
4. Validate UTF-8 from external input with `utf8.ValidString`
5. Use `strings.IndexByte` instead of `strings.Index` for single-byte searches
6. Prefer `strings.ContainsRune` for single-rune checks

---

## 18. Edge Cases

```go
// strings.Split on empty separator
parts := strings.Split("abc", "")
fmt.Println(parts) // [a b c]

// strings.SplitN
two := strings.SplitN("a:b:c:d", ":", 2) // [a b:c:d]

// strings.Trim vs TrimLeft vs TrimRight
fmt.Println(strings.Trim("xxhelloxx", "x"))      // hello
fmt.Println(strings.TrimLeft("xxhelloxx", "x"))  // helloxx
fmt.Println(strings.TrimRight("xxhelloxx", "x")) // xxhello

// strings.Cut with missing separator
before, after, found := strings.Cut("nodot", ".")
fmt.Println(before, after, found) // "nodot" "" false
```

---

## 19. Common Mistakes

### Mistake 1: Copying a strings.Builder

```go
var sb strings.Builder
sb.WriteString("Hello")
sb2 := sb             // copied
sb2.WriteString("!") // panic: illegal use of non-zero Builder copied by value
```

### Mistake 2: Ignoring strings.Cut found result

```go
// BAD
user, _, _ := strings.Cut(input, "@")

// GOOD
user, domain, found := strings.Cut(input, "@")
if !found {
    return fmt.Errorf("invalid email: missing @")
}
_ = domain
```

### Mistake 3: strings.Split for single-field parsing

```go
// BAD — allocates a slice
parts := strings.Split(line, "=")
key, value := parts[0], parts[1]

// GOOD — no slice allocation
key, value, found := strings.Cut(line, "=")
_ = found
```

---

## 20. Misconceptions

| Misconception | Truth |
|--------------|-------|
| `strings.Builder` is goroutine-safe | It is NOT thread-safe |
| `strings.Replace` modifies in place | Returns a new string; original unchanged |
| `strings.EqualFold` handles all Unicode | Only basic cases; use `golang.org/x/text/cases` for full Unicode |
| All string operations are O(n) | `strings.Count` with overlapping patterns can degrade |

---

## 21. Tricky Points

```go
// strings.Fields vs strings.Split
fmt.Println(strings.Fields("  a  b  c  "))  // [a b c] — strips leading/trailing
fmt.Println(strings.Split("  a  b  ", " ")) // [  a  b  ] — preserves empties

// strings.Builder Reset keeps capacity
var sb strings.Builder
sb.WriteString("Hello")
sb.Reset()            // length=0, capacity unchanged
sb.WriteString("Go")
fmt.Println(sb.String()) // Go

// Range gives rune type, not byte type
for _, r := range "A" {
    fmt.Printf("%T\n", r) // int32 (rune), not uint8 (byte)
}
```

---

## 22. Test

```go
package middle_test

import (
    "strings"
    "testing"
    "unicode/utf8"
)

func TestJoinWithSep(t *testing.T) {
    tests := []struct{ items []string; sep, want string }{
        {[]string{"a", "b", "c"}, ", ", "a, b, c"},
        {[]string{"only"}, ",", "only"},
        {nil, ",", ""},
    }
    for _, tc := range tests {
        got := joinWithSep(tc.items, tc.sep)
        if got != tc.want {
            t.Errorf("joinWithSep(%v, %q) = %q, want %q", tc.items, tc.sep, got, tc.want)
        }
    }
}

func TestRemoveNonPrintable(t *testing.T) {
    got := RemoveNonPrintable("Hello\x00World")
    if got != "HelloWorld" {
        t.Errorf("got %q", got)
    }
}

func TestSanitizeUTF8(t *testing.T) {
    if utf8.ValidString("\xff") {
        t.Error("\\xff should be invalid UTF-8")
    }
}
```

---

## 23. Tricky Questions

**Q: What does `strings.Split("a", "")` return?**
A: `["a"]` — a single-character string split by empty sep returns one element.

**Q: What is the difference between `strings.Trim` and `strings.TrimFunc`?**
A: `strings.Trim` removes characters in a cutset string; `strings.TrimFunc` uses a boolean predicate.

**Q: Can `strings.Builder` be reset and reused?**
A: Yes. `sb.Reset()` sets length to 0 but keeps allocated capacity for reuse.

**Q: What does `strings.Map` return when the function returns -1?**
A: The rune is dropped from the output entirely.

---

## 24. Cheat Sheet

```go
strings.NewReplacer(pairs...)          // multi-pattern replace in one pass
strings.Map(fn func(rune) rune, s)    // transform each rune
strings.IndexFunc(s, fn)              // find first rune matching predicate
strings.IndexByte(s, byte)            // faster single-byte search
strings.ContainsAny(s, chars)         // any char from set found?
strings.FieldsFunc(s, fn)             // split by predicate
strings.SplitN(s, sep, n)             // split into at most n parts
strings.SplitAfter(s, sep)            // include separator in results
strings.Clone(s)                      // Go 1.20+: independent copy
strings.NewReader(s)                  // io.Reader over a string
sb.Grow(n)                            // pre-allocate n more bytes
sb.Reset()                            // reset length, keep capacity
sb.Cap()                              // current capacity

utf8.RuneCountInString(s)
utf8.ValidString(s)
utf8.DecodeRuneInString(s)            // first rune + byte size
utf8.DecodeLastRuneInString(s)        // last rune + byte size
utf8.RuneLen(r)                       // bytes needed for rune r
```

---

## 25. Self-Assessment

- [ ] I understand the two-word string header (ptr + len)
- [ ] I know substring slicing keeps the backing array alive
- [ ] I can use `strings.Clone` to prevent memory leaks
- [ ] I know `strings.NewReplacer` for efficient multi-replacement
- [ ] I can use `strings.Map` to transform strings rune-by-rune
- [ ] I validate UTF-8 from external input
- [ ] I can benchmark string ops with `testing.B`
- [ ] I know the difference between `strings.Split` and `strings.Fields`

---

## 26. Summary

At the middle level, you work with string internals: the two-word header, backing array sharing, and substring memory leaks mitigated by `strings.Clone`. The `strings` package extends to rune-level transformation (`strings.Map`), efficient multi-pattern replacement (`strings.NewReplacer`), and custom splitting (`strings.FieldsFunc`). You pre-grow builders, validate UTF-8 from external input, and benchmark allocation behavior.

---

## 27. What You Can Build

- Full-featured CSV parser with quoting and escaping
- HTTP request/response formatter
- Simple expression tokenizer
- Log line parser with field extraction
- HTML/XML sanitizer using `strings.NewReplacer`
- Unicode-aware text statistics tool

---

## 28. Further Reading

- [Go Blog: Strings, bytes, runes and characters](https://go.dev/blog/strings)
- [pkg.go.dev/strings](https://pkg.go.dev/strings)
- [pkg.go.dev/unicode/utf8](https://pkg.go.dev/unicode/utf8)
- [strings.Clone proposal](https://github.com/golang/go/issues/40200)
- [golang.org/x/text — advanced Unicode](https://pkg.go.dev/golang.org/x/text)

---

## 29. Related Topics

- `bytes` package — same API as `strings` but for `[]byte`
- `bufio.Scanner` — line-by-line reading
- `regexp` package — pattern matching
- `unicode` package — character classification
- `strconv` package — number/string conversions
- `encoding/csv` — CSV parsing
- `golang.org/x/text` — Unicode normalization and collation

---

## 30. Diagrams

### Substring Memory Sharing

```
big = "AAAAAAAAAA...AAAAAAA" (1 MB)
      ^
      ptr

sub = big[:5]
      ^    ^
      ptr  len=5

sub still references big's 1 MB backing array!
Fix: strings.Clone(big[:5]) makes an independent 5-byte copy.
```

### strings.NewReplacer Conceptual Model

```
Input:    "<div>&</div>"
Pass 1:   scan for "<" or ">" or "&"
Replace:  emit &lt; for <, &amp; for &, &gt; for >
Result:   "&lt;div&gt;&amp;&lt;/div&gt;"
(single pass, no intermediate allocations per replacement)
```

---

## 31. Evolution

- **Go 1.0** — strings package, basic operations
- **Go 1.10** — `strings.Builder` added, making efficient building idiomatic
- **Go 1.18** — `strings.Cut` added for simple key/value parsing
- **Go 1.20** — `strings.Clone` added to solve substring memory leak problem
- **Go 1.21** — `strings.ContainsFunc` added for predicate-based containment check

---

## 32. Alternative Approaches

| Approach | When to Use |
|----------|------------|
| `strings.Builder` | General-purpose string building |
| `bytes.Buffer` | When you also need `io.Reader`/`io.Writer` |
| `fmt.Sprintf` | Small, formatted strings |
| `[]byte` + `append` | High-performance, allocation-sensitive paths |
| `strings.Join` | Joining a known slice |

---

## 33. Anti-Patterns

```go
// Anti-pattern 1: Stringly-typed data
type Config struct {
    Mode string // BAD: prefer a typed constant/enum
}

// Anti-pattern 2: Parsing without length check
parts := strings.Split(userInput, ",") // BAD: no bounds validation

// Anti-pattern 3: Copying a Builder value
sb1 := strings.Builder{}
sb1.WriteString("hi")
sb2 := sb1 // BAD: panic on next write to sb2

// Anti-pattern 4: Concatenation in hot loop
func formatAll(items []string) string {
    result := ""
    for _, s := range items {
        result += s + "\n" // BAD: O(n^2) allocations
    }
    return result
}
```

---

## 34. Debugging Guide

```go
// Print hex bytes of a string
func debugHex(s string) {
    fmt.Printf("len=%d bytes: ", len(s))
    for i := 0; i < len(s); i++ {
        fmt.Printf("%02x ", s[i])
    }
    fmt.Println()
}

// Find first invalid UTF-8 byte offset
func findInvalidUTF8(s string) int {
    for i, r := range s {
        if r == utf8.RuneError {
            b1 := s[i]
            _, size := utf8.DecodeRuneInString(s[i:])
            if size == 1 && b1 >= 0x80 {
                return i
            }
        }
    }
    return -1
}
```

---

## 35. Language Comparison

| Feature | Go | Python | Java | Rust |
|---------|-----|--------|------|------|
| Encoding | UTF-8 bytes | UTF-8 or bytes | UTF-16 | UTF-8 |
| Mutable | No | No | No | No (str), Yes (String) |
| Char access | By byte index | By code point index | By char (UTF-16 unit) | By byte index |
| Building | `strings.Builder` | list + join | `StringBuilder` | `String::push_str` |
| Length returns | Bytes | Code points | UTF-16 units | Bytes |
