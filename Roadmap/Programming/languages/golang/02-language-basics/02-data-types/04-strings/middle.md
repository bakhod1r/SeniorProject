# Strings in Go — Middle Level

## 1. Introduction

At the middle level, we move from "what strings are" to "why they work this way" and "when to choose different approaches." Go's string design is deliberate: immutability, byte-based indexing, and UTF-8 by convention are all intentional trade-offs that reflect Go's philosophy of simplicity and performance.

This guide digs into those design decisions, the internals of string operations, and how to use strings efficiently in real systems.

---

## 2. Prerequisites

- Comfortable with Go types, interfaces, and packages
- Understand `[]byte` and slices in Go
- Basic understanding of Unicode and UTF-8 encoding
- Experience with `strings` and `strconv` packages
- Familiar with Go's memory model and garbage collection basics

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **String header** | The internal `{ptr, len}` struct representing a string |
| **String interning** | Reusing identical string constants to save memory |
| **UTF-8** | Variable-width encoding: ASCII uses 1 byte, others use 2–4 bytes |
| **Code point** | A Unicode integer value (U+0041 = 'A') |
| **Grapheme cluster** | What a user perceives as a single "character" (may be multiple code points) |
| **Allocation** | Requesting memory from the heap |
| **strings.Builder** | A type optimized for incremental string construction |
| **SSO** | Small String Optimization (Go doesn't do this, but other languages do) |
| **Escape analysis** | Compiler analysis to determine if a value escapes to the heap |

---

## 4. Core Concepts (Deep Dive)

### String Internal Representation

A Go string is internally a struct:
```go
// reflect.StringHeader (the actual internal representation)
type StringHeader struct {
    Data uintptr // pointer to the first byte
    Len  int     // number of bytes
}
```

This is only 16 bytes on 64-bit systems (8 bytes pointer + 8 bytes int). Copying a string copies only this header — the underlying byte data is **shared**.

### Why Strings Are Immutable

1. **Concurrency safety**: Multiple goroutines can read the same string simultaneously without synchronization
2. **Efficient slicing**: Substrings can share memory with no copy
3. **Hashability**: Strings can be used as map keys because they can't change
4. **Compiler optimizations**: String literals can be placed in read-only memory

### UTF-8 Design

Go source code is UTF-8, string literals are UTF-8, and the standard library assumes UTF-8 — but the language doesn't *enforce* it. A `string` can hold any bytes:

```go
// Valid UTF-8
s1 := "Hello, 世界"

// Not valid UTF-8 — but Go allows it
s2 := "\xff\xfe"  // arbitrary bytes

// Check if valid UTF-8
import "unicode/utf8"
fmt.Println(utf8.ValidString(s1)) // true
fmt.Println(utf8.ValidString(s2)) // false
```

---

## 5. Evolution

Go 1.0 (2012): Basic string support, `strings` package.

Go 1.10 (2018): `strings.Builder` added — before this, `bytes.Buffer` was the standard way to build strings efficiently.

Go 1.12 (2019): Improvements to `strings.Map` performance.

Go 1.20 (2023): `unsafe.SliceData`, `unsafe.StringData` for zero-copy conversions.

Go 1.21 (2023): No string changes, but `slices` package added for working with slices.

The addition of `strings.Builder` in 1.10 was significant — it removed a common source of confusion where people used `bytes.Buffer` just for string building.

---

## 6. Why Strings Work This Way

### Why Byte-Based (Not Character-Based)?

Go's byte-based design was chosen because:
1. Network protocols, file systems, and OS APIs work in bytes
2. UTF-8 was designed by Go's creators (Ken Thompson and Rob Pike co-designed UTF-8)
3. Byte operations are faster than character operations for many use cases
4. Programs that only handle ASCII don't pay the cost of Unicode handling

### Why No `null` Terminator?

C strings end with a `\0` byte, which:
- Disallows `\0` bytes inside strings
- Requires O(n) to find the length
- Causes buffer overflow vulnerabilities

Go stores the length explicitly, so:
- Any byte can appear in a string (including `\0`)
- `len(s)` is O(1)
- No buffer overflow from string length

---

## 7. Alternative Approaches

### When to Use `[]byte` Instead of `string`

```go
// Use string when:
// - Data is immutable text
// - Using it as a map key
// - Passing to functions that expect string

// Use []byte when:
// - You need to modify the content
// - Working with binary data
// - Reading from io.Reader
// - Building incrementally with lots of modifications

// Convert only when necessary — each conversion allocates
```

### When to Use `strings.Builder` vs `bytes.Buffer`

```go
// strings.Builder: best for building strings from strings/runes/bytes
var sb strings.Builder
sb.WriteString("Hello")
sb.WriteRune(',')
sb.WriteByte(' ')
sb.WriteString("World")
result := sb.String()

// bytes.Buffer: better when you also need io.Reader/io.Writer interface
var buf bytes.Buffer
fmt.Fprintf(&buf, "Hello, %s!", name)
reader := &buf  // implements io.Reader
```

---

## 8. Anti-Patterns

```go
// Anti-pattern 1: String concatenation in loops
func joinBad(items []string) string {
    result := ""
    for _, item := range items {
        result += item + ","  // O(n²) allocations!
    }
    return result
}

// Better:
func joinGood(items []string) string {
    return strings.Join(items, ",")
}

// Anti-pattern 2: Unnecessary byte conversion
func containsBad(s, sub string) bool {
    return strings.Contains(string([]byte(s)), sub) // pointless conversion
}

// Anti-pattern 3: Using fmt.Sprintf for simple concatenation
name := "Alice"
s := fmt.Sprintf("%s", name)  // just use name directly!

// Anti-pattern 4: Case-insensitive compare the wrong way
if strings.ToLower(a) == strings.ToLower(b) { // two allocations
    // use strings.EqualFold(a, b) instead — no allocations
}
```

---

## 9. Pros & Cons (Deeper Analysis)

### Immutability Pros
- Thread-safe by default
- Predictable behavior (no aliasing bugs)
- Allows string constants in read-only memory segment
- Makes strings valid map keys

### Immutability Cons
- Every "modification" is a new allocation
- Building strings incrementally requires a Builder
- Cannot fix encoding errors in place

### Byte Semantics Pros
- Simple, low-level, predictable
- Efficient for ASCII and binary data
- Maps directly to OS/network APIs

### Byte Semantics Cons
- Confusing when working with non-ASCII text
- `len()` doesn't give you what users think of as "length"
- Slicing can cut through multi-byte characters

---

## 10. Real-World Use Cases

### Use Case 1: HTTP Request Routing

```go
func (mux *ServeMux) match(path string) handler {
    // Exact match first
    if h, ok := mux.routes[path]; ok {
        return h
    }
    // Prefix match
    for prefix, h := range mux.prefixes {
        if strings.HasPrefix(path, prefix) {
            return h
        }
    }
    return mux.notFound
}
```

### Use Case 2: Log Parsing

```go
func parseLogLine(line string) (LogEntry, error) {
    // "2024-01-15 10:30:45 ERROR connection refused"
    parts := strings.SplitN(line, " ", 4)
    if len(parts) != 4 {
        return LogEntry{}, fmt.Errorf("invalid log format: %q", line)
    }
    return LogEntry{
        Date:    parts[0],
        Time:    parts[1],
        Level:   parts[2],
        Message: parts[3],
    }, nil
}
```

### Use Case 3: Template Substitution

```go
func substitute(template string, vars map[string]string) string {
    var b strings.Builder
    b.Grow(len(template)) // pre-allocate approximate size

    i := 0
    for i < len(template) {
        if template[i] == '{' && i+1 < len(template) && template[i+1] == '{' {
            end := strings.Index(template[i:], "}}")
            if end >= 0 {
                key := template[i+2 : i+end]
                if val, ok := vars[key]; ok {
                    b.WriteString(val)
                } else {
                    b.WriteString(template[i : i+end+2])
                }
                i += end + 2
                continue
            }
        }
        b.WriteByte(template[i])
        i++
    }
    return b.String()
}
```

---

## 11. Code Examples

### Example 1: Efficient String Building

```go
package main

import (
    "fmt"
    "strings"
)

// BuildCSVRow creates a CSV row from fields
func BuildCSVRow(fields []string) string {
    var b strings.Builder
    // Pre-allocate: estimate final size to reduce reallocations
    total := 0
    for _, f := range fields {
        total += len(f) + 1 // +1 for comma or newline
    }
    b.Grow(total)

    for i, field := range fields {
        if i > 0 {
            b.WriteByte(',')
        }
        // Quote fields that contain commas or quotes
        if strings.ContainsAny(field, ",\"") {
            b.WriteByte('"')
            b.WriteString(strings.ReplaceAll(field, "\"", "\"\""))
            b.WriteByte('"')
        } else {
            b.WriteString(field)
        }
    }
    b.WriteByte('\n')
    return b.String()
}

func main() {
    row := BuildCSVRow([]string{"Alice", "30", "New York, NY", `He said "hello"`})
    fmt.Print(row) // Alice,30,"New York, NY","He said ""hello"""
}
```

### Example 2: Unicode-Aware String Operations

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

// RuneCount returns the number of Unicode characters in s
func RuneCount(s string) int {
    return utf8.RuneCountInString(s)
}

// RuneAt returns the rune at the given character position (not byte position)
func RuneAt(s string, charPos int) (rune, bool) {
    i := 0
    for pos, r := range s {
        if i == charPos {
            _ = pos
            return r, true
        }
        i++
    }
    return 0, false
}

// TruncateToChars truncates s to at most n Unicode characters
func TruncateToChars(s string, n int) string {
    count := 0
    for i := range s {
        if count == n {
            return s[:i]
        }
        count++
    }
    return s
}

func main() {
    s := "Hello, 世界! 👋"
    fmt.Println(len(s))            // bytes: varies
    fmt.Println(RuneCount(s))      // characters
    fmt.Println(TruncateToChars(s, 7)) // "Hello, "
}
```

### Example 3: String Interning for Memory Efficiency

```go
package main

import "sync"

// StringInterner deduplicates strings to save memory
// Useful when many goroutines produce the same string values
type StringInterner struct {
    mu    sync.RWMutex
    table map[string]string
}

func NewStringInterner() *StringInterner {
    return &StringInterner{table: make(map[string]string)}
}

// Intern returns a canonical copy of s
func (si *StringInterner) Intern(s string) string {
    si.mu.RLock()
    if canonical, ok := si.table[s]; ok {
        si.mu.RUnlock()
        return canonical
    }
    si.mu.RUnlock()

    si.mu.Lock()
    defer si.mu.Unlock()
    if canonical, ok := si.table[s]; ok {
        return canonical // double-check after acquiring write lock
    }
    si.table[s] = s
    return s
}
```

---

## 12. Coding Patterns

### Pattern 1: Streaming String Processing

```go
func processLines(input string, fn func(string) string) string {
    lines := strings.Split(input, "\n")
    for i, line := range lines {
        lines[i] = fn(line)
    }
    return strings.Join(lines, "\n")
}

// Usage: trim spaces from all lines
result := processLines(input, strings.TrimSpace)
```

### Pattern 2: String as Map Key

```go
// Strings make excellent map keys — immutable and comparable
type Cache struct {
    data map[string]interface{}
}

func (c *Cache) Get(key string) (interface{}, bool) {
    v, ok := c.data[key]
    return v, ok
}
```

### Pattern 3: Lazy String Formatting

```go
// Don't format if logging level won't show it
type Logger struct{ level int }

func (l *Logger) Debug(format string, args ...interface{}) {
    if l.level <= DEBUG {
        fmt.Println(fmt.Sprintf(format, args...))
    }
}
```

---

## 13. Clean Code

```go
// Use named constants for repeated string values
const (
    StatusActive   = "active"
    StatusInactive = "inactive"
    StatusPending  = "pending"
)

// Use string types for domain concepts
type UserID string
type Email string

func sendEmail(to Email, subject string) error {
    // type system prevents accidentally passing UserID where Email is expected
    return nil
}

// Validate at boundaries, not deep in business logic
func NewEmail(s string) (Email, error) {
    s = strings.TrimSpace(s)
    if !strings.Contains(s, "@") {
        return "", fmt.Errorf("invalid email: %q", s)
    }
    return Email(strings.ToLower(s)), nil
}
```

---

## 14. Debugging Guide

### Problem: Unexpected String Length
```go
// When len(s) is larger than expected:
s := "café"
fmt.Println(len(s))          // 5, not 4!
fmt.Println(len([]rune(s)))  // 4

// Solution: use utf8.RuneCountInString for character count
import "unicode/utf8"
fmt.Println(utf8.RuneCountInString(s)) // 4
```

### Problem: Garbled Unicode Output
```go
// When slicing produces garbled text:
s := "Hello, 世界"
fmt.Println(s[7:9]) // might show garbled bytes

// Solution: convert to runes first
r := []rune(s)
fmt.Println(string(r[7:9])) // safe character slicing
```

### Problem: String Comparison Failing
```go
// When == comparison unexpectedly fails:
a := "  hello  "
b := "hello"
fmt.Println(a == b) // false — whitespace!

// Use TrimSpace before comparing user input
fmt.Println(strings.TrimSpace(a) == b) // true
```

### Using `%q` for Debugging
```go
// %q shows escape sequences — reveals hidden characters
s := "hello\tworld\n"
fmt.Printf("%s\n", s) // hello    world (tab and newline rendered)
fmt.Printf("%q\n", s) // "hello\tworld\n" (shows escapes)
```

---

## 15. Comparison with Other Languages

| Feature | Go | Python | Java | JavaScript |
|---------|-----|--------|------|------------|
| Mutability | Immutable | Immutable | Immutable | Immutable |
| Encoding | Bytes (UTF-8 convention) | Unicode (str) / bytes | UTF-16 | UTF-16 |
| `len()` returns | Bytes | Characters | Chars (UTF-16 units) | Chars (UTF-16 units) |
| Index `s[i]` | Byte | Character (str) | char (UTF-16 unit) | char (UTF-16 unit) |
| Null-terminated | No | No | No | No |
| Can be map key | Yes | Yes | Yes (hashCode) | Yes |
| Concatenation | `+` or Builder | `+` or `join` | `+` or `StringBuilder` | `+` or template literal |

**Key difference**: Go and Python both use UTF-8 internally (for source), but Python's `str` type abstracts over code points while Go exposes bytes directly.

**Java/JavaScript** use UTF-16, which means surrogate pairs for characters outside the Basic Multilingual Plane. Go's UTF-8 approach is simpler and more memory-efficient for primarily ASCII text.

---

## 16. Error Handling

```go
import "unicode/utf8"

// Validate and handle invalid UTF-8
func sanitizeUTF8(s string) string {
    if utf8.ValidString(s) {
        return s
    }
    // Replace invalid sequences with replacement character (U+FFFD)
    return strings.ToValidUTF8(s, "\ufffd")
}

// Handle parsing errors with context
func parseVersion(s string) (major, minor int, err error) {
    parts := strings.SplitN(s, ".", 2)
    if len(parts) != 2 {
        return 0, 0, fmt.Errorf("parseVersion: invalid format %q, expected MAJOR.MINOR", s)
    }
    major, err = strconv.Atoi(parts[0])
    if err != nil {
        return 0, 0, fmt.Errorf("parseVersion: invalid major version %q: %w", parts[0], err)
    }
    minor, err = strconv.Atoi(parts[1])
    if err != nil {
        return 0, 0, fmt.Errorf("parseVersion: invalid minor version %q: %w", parts[1], err)
    }
    return major, minor, nil
}
```

---

## 17. Security Considerations

### Timing Attacks on String Comparison

```go
import "crypto/subtle"

// BAD: timing-vulnerable password comparison
if storedHash == computedHash {
    // an attacker can measure time to find matching prefix
}

// GOOD: constant-time comparison
if subtle.ConstantTimeCompare([]byte(storedHash), []byte(computedHash)) == 1 {
    // safe — always takes the same time regardless of where mismatch occurs
}
```

### String Sanitization

```go
import "html"

// Prevent XSS when rendering user content in HTML
func renderUserContent(s string) string {
    return html.EscapeString(s)
    // "Hello <script>alert(1)</script>" →
    // "Hello &lt;script&gt;alert(1)&lt;/script&gt;"
}
```

---

## 18. Performance Tips

### Pre-allocate with `strings.Builder.Grow()`

```go
func buildLargeString(n int) string {
    var b strings.Builder
    b.Grow(n * 10) // estimate final size
    for i := 0; i < n; i++ {
        fmt.Fprintf(&b, "item %d\n", i)
    }
    return b.String()
}
```

### Avoid Allocation in Hot Paths

```go
// strings.Contains doesn't allocate — use it freely
if strings.Contains(path, "..") { // safe check, no allocation
    return errors.New("path traversal")
}

// But strings.ToLower DOES allocate — avoid in tight loops
// Instead: use strings.EqualFold for case-insensitive comparison
if strings.EqualFold(method, "get") { // no allocation!
    handleGet()
}
```

### Zero-Copy Conversions (Advanced)

```go
import "unsafe"

// Convert []byte to string without allocation (CAREFUL: must not modify bytes)
func bytesToStringUnsafe(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

// Only use when:
// 1. You own the []byte and won't modify it
// 2. The string doesn't outlive the []byte
// 3. You've profiled and confirmed allocation is a bottleneck
```

---

## 19. Metrics & Analytics

```go
// Track string operation performance
type StringMetrics struct {
    concatCount    int64
    builderCount   int64
    totalBytesBuilt int64
}

func (m *StringMetrics) RecordConcat(resultLen int) {
    atomic.AddInt64(&m.concatCount, 1)
    atomic.AddInt64(&m.totalBytesBuilt, int64(resultLen))
}
```

---

## 20. Best Practices

1. **Use `strings.Builder`** for any loop with string concatenation
2. **Use `strings.EqualFold`** for case-insensitive comparison (avoids allocation)
3. **Use `%q` verb** when debugging strings (reveals hidden characters)
4. **Validate UTF-8** when receiving strings from external sources
5. **Use `utf8.RuneCountInString`** when you need character count
6. **Avoid unnecessary conversions** between `string` and `[]byte`
7. **Pre-allocate** with `b.Grow(n)` when you know approximate final size
8. **Use typed strings** (`type Email string`) for domain concepts to leverage type safety

---

## 21. Edge Cases & Pitfalls

```go
// Pitfall 1: strings.Split behavior with empty separator
parts := strings.Split("abc", "")
fmt.Println(parts) // ["a", "b", "c"] — splits into individual characters

// Pitfall 2: strings.Split on empty string
parts = strings.Split("", ",")
fmt.Println(len(parts)) // 1, not 0! [""] — one empty string element

// Pitfall 3: SplitN vs Split
parts = strings.SplitN("a:b:c:d", ":", 2)
fmt.Println(parts) // ["a", "b:c:d"] — only splits at first separator

// Pitfall 4: Replace with n=-1 is the same as ReplaceAll
s := strings.Replace("aaa", "a", "b", -1) // "bbb"
s  = strings.ReplaceAll("aaa", "a", "b")   // "bbb" — same result

// Pitfall 5: strings.Index returns -1, not error
idx := strings.Index("hello", "xyz")
if idx == -1 { // must check for -1!
    fmt.Println("not found")
}
```

---

## 22. Common Mistakes

```go
// Mistake 1: Not checking strings.Builder error returns
// (Builder's Write methods never return errors, but other io.Writers do)
var b strings.Builder
b.WriteString("hello") // error return can safely be ignored for Builder

// Mistake 2: Thinking b.Reset() frees memory
var b strings.Builder
for i := 0; i < 1000; i++ {
    b.WriteString(bigString)
    process(b.String())
    b.Reset() // resets len to 0, but keeps allocated capacity
}
// This is actually GOOD — avoids reallocating the buffer each iteration

// Mistake 3: Using strings.Builder concurrently
// strings.Builder is NOT safe for concurrent use!
var b strings.Builder
go b.WriteString("hello") // DATA RACE
go b.WriteString("world") // DATA RACE
```

---

## 23. Common Misconceptions

| Misconception | Reality |
|--------------|---------|
| String slicing copies data | Slicing creates a new header pointing to same data |
| `strings.Builder` is always faster than `bytes.Buffer` | Performance is similar; use Builder for string-specific APIs |
| `string([]byte{...})` creates a read-only copy | Yes, but the compiler sometimes optimizes this away |
| Strings are comparable with `<` by Unicode value | `<` is lexicographic byte comparison, not Unicode code point order |

---

## 24. Tricky Points

```go
// Tricky 1: String comparison is byte-by-byte, not locale-aware
// "é" (U+00E9, 2 bytes) < "f" because 0xC3 < 0x66 in UTF-8
fmt.Println("é" < "f") // true

// Tricky 2: A nil []byte converts to an empty string, not a nil string
var b []byte = nil
s := string(b)
fmt.Println(s == "")    // true
fmt.Println(s == nil)   // compile error!

// Tricky 3: strings.Builder.String() returns a view, not a copy
var b strings.Builder
b.WriteString("hello")
s := b.String()  // shares memory with Builder's buffer
b.WriteString(" world") // may invalidate s if reallocation happens
// After reallocation, s is safe (old buffer still referenced by s)
// But before reallocation, s and Builder share memory — use with care
```

---

## 25. Test

```go
package strings_test

import (
    "strings"
    "testing"
)

func BenchmarkConcatenation(b *testing.B) {
    words := []string{"hello", "world", "foo", "bar", "baz"}

    b.Run("plus_operator", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            result := ""
            for _, w := range words {
                result += w
            }
            _ = result
        }
    })

    b.Run("strings_join", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            result := strings.Join(words, "")
            _ = result
        }
    })

    b.Run("builder", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            var sb strings.Builder
            for _, w := range words {
                sb.WriteString(w)
            }
            result := sb.String()
            _ = result
        }
    })
}

func TestParseVersion(t *testing.T) {
    tests := []struct {
        input      string
        wantMajor  int
        wantMinor  int
        wantErr    bool
    }{
        {"1.2", 1, 2, false},
        {"10.0", 10, 0, false},
        {"abc", 0, 0, true},
        {"1.2.3", 0, 0, true},
    }

    for _, tt := range tests {
        major, minor, err := parseVersion(tt.input)
        if (err != nil) != tt.wantErr {
            t.Errorf("parseVersion(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
            continue
        }
        if !tt.wantErr && (major != tt.wantMajor || minor != tt.wantMinor) {
            t.Errorf("parseVersion(%q) = (%d, %d), want (%d, %d)",
                tt.input, major, minor, tt.wantMajor, tt.wantMinor)
        }
    }
}
```

---

## 26. Tricky Questions

**Q: Why does `for i := range s` give byte indices, not character indices?**
A: Because Go strings are byte slices. The `range` loop on a string decodes UTF-8 runes, but the index `i` is always the **byte position** of the start of the rune, not the rune's ordinal position.

**Q: What is the output of `fmt.Println(string(rune(128)))`?**
A: `"\u0080"` — the Unicode code point 128 (in Latin-1 Supplement), which is a 2-byte UTF-8 sequence (0xC2 0x80).

**Q: Can two different string variables point to the same underlying memory?**
A: Yes! String slicing creates new headers pointing to the same data. Also, string literals with the same value in Go are often interned (same pointer).

**Q: What happens to a `strings.Builder` after calling `b.String()`?**
A: The builder is still valid and can continue to be written to. `String()` returns a snapshot, but the builder keeps its buffer.

---

## 27. Cheat Sheet (Advanced)

```go
// Zero-allocation alternatives
strings.EqualFold(a, b)  // case-insensitive compare (no alloc)
strings.ContainsRune(s, r)  // check for specific rune
strings.IndexByte(s, b)  // find byte in string

// Builder pre-allocation
var b strings.Builder
b.Grow(expectedLen)  // hint to avoid reallocations

// Efficient splitting
for _, line := range strings.Lines(text) { // Go 1.24+
    process(line)
}

// Rune counting
utf8.RuneCountInString(s)  // character count
utf8.ValidString(s)        // UTF-8 validity check

// String to/from number
strconv.Itoa(42)            // int → string
strconv.Atoi("42")          // string → int
strconv.FormatFloat(3.14, 'f', 2, 64)  // float → string
strconv.ParseFloat("3.14", 64)          // string → float
```

---

## 28. Self-Assessment Checklist

- [ ] I know the internal structure of a Go string (`{ptr, len}`)
- [ ] I understand why strings are immutable and the trade-offs
- [ ] I can choose between `strings.Builder`, `bytes.Buffer`, and `+`
- [ ] I know when `[]byte` is more appropriate than `string`
- [ ] I understand UTF-8 encoding and how it affects `len()` and indexing
- [ ] I can implement Unicode-aware string operations
- [ ] I use `strings.EqualFold` for case-insensitive comparison
- [ ] I know how to detect and handle invalid UTF-8
- [ ] I understand string interning and when it matters
- [ ] I can write benchmarks to compare string operation performance

---

## 29. Summary

At the middle level, Go strings are understood as:
- **An internal struct** with a pointer and length (16 bytes)
- **Immutable** by design for concurrency safety and efficient slicing
- **Byte-based** to interface naturally with OS and network APIs
- **UTF-8 by convention**, not by enforcement
- **Efficiently handled** by using the right tool: `+` for simple cases, `strings.Builder` for loops, `strings.EqualFold` for case-insensitive comparison

The key skill is knowing the cost of each operation and choosing the right approach for the context.

---

## 30. Further Reading

- [Go Blog: Strings, bytes, runes and characters in Go](https://go.dev/blog/strings)
- [Go Spec: String types](https://go.dev/ref/spec#String_types)
- [unicode/utf8 package docs](https://pkg.go.dev/unicode/utf8)
- [strings package docs](https://pkg.go.dev/strings)
- [Go 1.10 Release Notes: strings.Builder](https://go.dev/doc/go1.10#strings)
- [Russ Cox: UTF-8 and Go](https://research.swtch.com/utf8)

---

## 31. Related Topics

- `unicode/utf8` — UTF-8 encoding/decoding functions
- `unicode` — character classification (IsLetter, IsDigit, etc.)
- `strconv` — conversions between strings and other types
- `regexp` — regular expression matching on strings
- `text/template` — Go's text templating engine
- `bytes` — same operations as `strings` but for `[]byte`
- `io.Reader` / `strings.NewReader` — treating strings as streams
- `encoding/json` — JSON marshaling uses string extensively

---

## 32. Diagrams & Visual Aids

### String Sharing After Slicing
```
original := "Hello, World!"
sub := original[7:12]

original:   ┌─ptr─┬─len=13─┐
            │  ●  │        │
            └──┼──┴────────┘
               │
               ▼
Memory:  H e l l o ,   W o r l d !
         0 1 2 3 4 5 6 7 8 9 ...

sub:        ┌─ptr─┬─len=5──┐
            │  ●  │        │
            └──┼──┴────────┘
               │
               └──────► points to index 7 (same memory!)
```

### UTF-8 Byte Layout
```
"Hello, 世界"

Char:  H  e  l  l  o  ,     世         界
Byte:  48 65 6c 6c 6f 2c 20 e4 b8 96  e7 95 8c
Index: 0  1  2  3  4  5  6  7  8  9   10 11 12
```
