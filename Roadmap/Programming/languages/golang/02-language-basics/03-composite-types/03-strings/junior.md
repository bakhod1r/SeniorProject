# Strings in Go — Junior Level

## 1. Introduction — What is it?

A string in Go is a composite type that represents an immutable sequence of bytes. Unlike many languages where strings are objects with methods, Go strings are simple, value-typed byte sequences. Internally, a string is a two-word structure: a pointer to the underlying byte array and a length. This makes strings lightweight to copy and pass around.

```go
s := "Hello, 世界"
fmt.Println(s)        // Hello, 世界
fmt.Println(len(s))   // 13 — bytes, not characters!
```

Strings in Go are not null-terminated (unlike C), and they can contain any byte, including zero bytes.

---

## 2. Prerequisites

Before learning strings in Go, you should understand:

- Basic Go syntax (variables, types, functions)
- What a byte is (8 bits, range 0–255)
- The concept of ASCII and Unicode (UTF-8)
- Go's basic data types (`int`, `bool`, `byte`, `rune`)
- How to import packages (`import "fmt"`)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **String** | Immutable sequence of bytes in Go |
| **byte** | Alias for `uint8`; one unit of a string |
| **rune** | Alias for `int32`; represents a Unicode code point |
| **UTF-8** | Variable-width encoding used by Go strings |
| **code point** | A unique number assigned to each Unicode character |
| **immutable** | Cannot be changed after creation |
| **string header** | Internal struct with ptr and len fields |
| **strings package** | Standard library package for string operations |
| **Builder** | `strings.Builder` — efficient string concatenation tool |
| **raw string literal** | Backtick string that preserves newlines and backslashes |

---

## 4. Core Concepts

### 4.1 String Literals

```go
// Interpreted string literal (double quotes)
s1 := "Hello\nWorld"   // \n is a newline

// Raw string literal (backticks)
s2 := `Hello\nWorld`   // \n is literal backslash + n
```

### 4.2 String is Bytes, Not Characters

```go
s := "Hello"
fmt.Println(len(s))   // 5 — 5 bytes

s2 := "世界"
fmt.Println(len(s2))  // 6 — 6 bytes (3 bytes per Chinese character in UTF-8)
```

### 4.3 Indexing Returns Bytes

```go
s := "Hello"
fmt.Println(s[0])         // 72 — byte value of 'H'
fmt.Printf("%c\n", s[0]) // H — print as character
```

### 4.4 Strings Are Immutable

```go
s := "Hello"
// s[0] = 'h'  // COMPILE ERROR: cannot assign to s[0]

// To modify, convert to []byte first
b := []byte(s)
b[0] = 'h'
s = string(b)
fmt.Println(s) // hello
```

### 4.5 String Concatenation

```go
s1 := "Hello"
s2 := ", World"
s3 := s1 + s2
fmt.Println(s3) // Hello, World
```

---

## 5. Real-World Analogies

**String as a Newspaper Article:**
Think of a string like a printed newspaper article. You can read it, copy it, cut it apart and read sections — but you cannot change the original printing. If you want a modified version, you must print a new copy.

**String Header as a Library Card:**
The string header (pointer + length) is like a library card. It does not contain the book content itself — it just says "the book is on shelf X, and it has Y pages." Copying a string copies the card, not the book.

**UTF-8 as Variable-Size Boxes:**
ASCII characters fit in one small box (1 byte). European characters need a medium box (2 bytes). Chinese characters need a large box (3 bytes). UTF-8 uses the right box size for each character.

---

## 6. Mental Models

### Model 1: The Transparent Tape

A string is like transparent tape over an array of bytes. You can look through the tape and read the bytes, but you cannot peel the tape and change what is underneath without creating a new piece of tape.

### Model 2: The Two-Word Header

```
String s = "Hello"

Stack:           Heap:
+--------+       +---+---+---+---+---+
| ptr ———+——————>| H | e | l | l | o |
| len=5  |       +---+---+---+---+---+
+--------+
```

### Model 3: Rune vs Byte

```
"A"  = 1 byte  = 0x41
"e"  = 2 bytes = 0xC3 0xA9  (with accent: e-acute)
"世" = 3 bytes = 0xE4 0xB8 0x96
```

---

## 7. Pros and Cons

### Pros

- **Immutability** makes strings safe to share across goroutines without locking
- **Lightweight copying** — only copies the 16-byte header (pointer + length), not the content
- **UTF-8 native** — Go source code is UTF-8, string literals are UTF-8
- **Simple interface** — just bytes with no hidden complexity
- **Efficient slicing** — creating substrings shares the underlying array

### Cons

- **Immutability** means every modification creates a new allocation
- **Byte vs rune confusion** — `len()` returns bytes, range returns runes
- **No direct character indexing** — `s[i]` gives a byte, not a Unicode character
- **String building with `+`** is O(n squared) in loops
- **No built-in trim/split** — must use the `strings` package

---

## 8. Use Cases

- **User input processing** — reading and validating text from users
- **File paths and URLs** — working with system paths and web addresses
- **JSON/XML parsing** — handling structured text data
- **Log messages** — formatting and writing log entries
- **Configuration values** — storing settings as text
- **Database queries** — SQL query strings
- **Template rendering** — HTML/text template output
- **Command output** — processing results from shell commands

---

## 9. Code Examples

### Example 1: Basic String Operations

```go
package main

import "fmt"

func main() {
    s := "Hello, Go!"

    // Length (bytes)
    fmt.Println("Length:", len(s)) // 10

    // Access bytes
    fmt.Println("First byte:", s[0])         // 72
    fmt.Printf("First char: %c\n", s[0])    // H

    // Slicing (creates a new string header sharing data)
    fmt.Println("Slice:", s[0:5]) // Hello
    fmt.Println("From 7:", s[7:]) // Go!
    fmt.Println("To 5:", s[:5])   // Hello

    // Comparison
    fmt.Println("Equal:", s == "Hello, Go!") // true
    fmt.Println("Less:", "abc" < "abd")       // true (lexicographic)
}
```

### Example 2: Iterating with Range (Rune-safe)

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"

    // Range iterates over Unicode code points (runes)
    fmt.Println("Rune iteration:")
    for i, r := range s {
        fmt.Printf("  index=%d, rune=%c\n", i, r)
    }
    // Note: index jumps by 3 for Chinese characters

    // Byte count
    fmt.Println("\nByte count:", len(s))  // 13

    // Rune count
    count := 0
    for range s {
        count++
    }
    fmt.Println("Rune count:", count) // 9
}
```

### Example 3: Using the strings Package

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    s := "  Hello, World!  "

    fmt.Println(strings.TrimSpace(s))             // "Hello, World!"
    fmt.Println(strings.Contains(s, "World"))     // true

    csv := "apple,banana,cherry"
    parts := strings.Split(csv, ",")
    fmt.Println(parts)                            // [apple banana cherry]
    fmt.Println(strings.Join(parts, " | "))       // apple | banana | cherry

    fmt.Println(strings.ToUpper("hello"))         // HELLO
    fmt.Println(strings.ToLower("WORLD"))         // world

    fmt.Println(strings.Replace("aaa", "a", "b", 2)) // bba
    fmt.Println(strings.ReplaceAll("aaa", "a", "b")) // bbb

    fmt.Println(strings.HasPrefix("Hello", "He"))    // true
    fmt.Println(strings.HasSuffix("Hello", "lo"))    // true
}
```

---

## 10. Coding Patterns

### Pattern 1: Safe String Building with strings.Builder

```go
var sb strings.Builder
words := []string{"Go", "is", "awesome"}
for i, word := range words {
    if i > 0 {
        sb.WriteByte(' ')
    }
    sb.WriteString(word)
}
result := sb.String()
fmt.Println(result) // Go is awesome
```

### Pattern 2: Convert Between string and []byte

```go
s := "Hello"
b := []byte(s)    // string -> []byte (allocates a copy)
b[0] = 'h'
s2 := string(b)   // []byte -> string (allocates a copy)
fmt.Println(s2)   // hello
```

### Pattern 3: Parse with strings.Cut

```go
email := "user@example.com"
user, domain, found := strings.Cut(email, "@")
if found {
    fmt.Println("User:", user)     // user
    fmt.Println("Domain:", domain) // example.com
}
```

---

## 11. Clean Code

- Use `strings.Builder` instead of `+` in loops
- Use named constants for repeated string values
- Prefer `strings.EqualFold` for case-insensitive comparison
- Use `strings.TrimSpace` when handling user input
- Avoid unnecessary `string([]byte(...))` roundtrips

```go
// Bad — O(n^2) allocations
name := "Alice"
for i := 0; i < 10; i++ {
    name = name + "!"
}

// Good — O(n) with Builder
var sb strings.Builder
sb.WriteString("Alice")
for i := 0; i < 10; i++ {
    sb.WriteByte('!')
}
name := sb.String()
```

---

## 12. Product Use / Feature

Strings are at the heart of nearly every feature:

- **Authentication** — usernames, passwords, tokens are strings
- **Search** — full-text search requires string processing
- **Localization** — UI text and translations are strings
- **APIs** — JSON payloads, HTTP headers, URLs are strings
- **Databases** — queries, column values, table names are strings
- **Logging** — all log messages are strings
- **Configuration** — `.env` files, YAML/JSON configs are parsed strings

---

## 13. Error Handling

String operations rarely return errors, but conversions can fail:

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // strconv.Atoi — convert string to int
    n, err := strconv.Atoi("42")
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Number:", n) // 42
    }

    // Invalid conversion
    n, err = strconv.Atoi("abc")
    if err != nil {
        // strconv.Atoi: parsing "abc": invalid syntax
        fmt.Println("Error:", err)
    }
}
```

---

## 14. Security

- **Never build SQL queries by concatenating strings** — use parameterized queries
- **HTML escaping** — use `html.EscapeString` before inserting user input into HTML
- **Path traversal** — validate file paths built from user input
- **Timing attacks** — use `subtle.ConstantTimeCompare` for comparing secrets

```go
import "html"

userInput := "<script>alert('xss')</script>"
safe := html.EscapeString(userInput)
fmt.Println(safe) // &lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;
```

---

## 15. Performance Tips

- Use `strings.Builder` for building strings in loops (O(n) vs O(n^2))
- Use `strings.Contains` instead of regex for simple substring checks
- Avoid unnecessary `string()` and `[]byte()` conversions
- Use `strings.Index` when you need the position of a substring
- For very hot paths, consider operating on `[]byte` throughout

```go
// Fast: strings.Builder
var b strings.Builder
for i := 0; i < 1000; i++ {
    fmt.Fprintf(&b, "%d ", i)
}

// Slow: concatenation
s := ""
for i := 0; i < 1000; i++ {
    s += fmt.Sprintf("%d ", i)  // 1000 allocations!
}
```

---

## 16. Metrics

When working with strings in production:

- **Allocation rate** — heavy `+` usage in hot paths increases GC pressure
- **String length** — unbounded user input can cause memory spikes
- **UTF-8 decode time** — iterating runes is slower than iterating bytes
- **Copy overhead** — every string to `[]byte` conversion allocates

---

## 17. Best Practices

1. Always use `strings.Builder` for building strings in loops
2. Use `range` (not index loop) when iterating over multi-byte characters
3. Use `utf8.RuneCountInString(s)` for counting characters, not `len(s)`
4. Prefer `strings.EqualFold` over `strings.ToLower() ==` comparisons
5. Trim user input with `strings.TrimSpace` before validation
6. Use raw string literals (backticks) for multi-line strings and regex patterns
7. Always check `found` when using `strings.Cut` or check index != -1 with `strings.Index`

---

## 18. Edge Cases

```go
// Empty string
s := ""
fmt.Println(len(s))    // 0
fmt.Println(s == "")   // true
for range s { }        // zero iterations — perfectly safe

// String with null byte — Go handles it fine
s2 := "hello\x00world"
fmt.Println(len(s2))   // 11

// Very long string — only the header is copied on assignment
big := strings.Repeat("a", 1_000_000)
copy := big              // only 16 bytes copied, not 1MB
_ = copy

// Substring still references original backing array
sub := big[0:100]        // references the 1MB backing array
_ = sub
```

---

## 19. Common Mistakes

### Mistake 1: Using len() for character count

```go
s := "世界"
fmt.Println(len(s))                        // 6 — counts bytes, not characters
fmt.Println(utf8.RuneCountInString(s))     // 2 — correct character count
```

### Mistake 2: Trying to modify string directly

```go
s := "Hello"
// s[0] = 'h'  // COMPILE ERROR: cannot assign to s[0]
```

### Mistake 3: String concatenation in loops

```go
// BAD — each += allocates a new string
result := ""
for _, word := range words {
    result += word + " "
}

// GOOD — Builder is O(n)
var sb strings.Builder
for _, word := range words {
    sb.WriteString(word)
    sb.WriteByte(' ')
}
result := strings.TrimSpace(sb.String())
```

---

## 20. Misconceptions

| Misconception | Truth |
|--------------|-------|
| `len(s)` counts characters | It counts bytes |
| Strings are mutable | They are immutable |
| `s[i]` gives a character | It gives a byte value (`uint8`) |
| Copying a string is expensive | Only the 16-byte header is copied |
| Strings can be nil | Strings cannot be nil; the zero value is `""` |
| `==` compares pointers | It compares content byte-by-byte |

---

## 21. Tricky Points

```go
// Tricky 1: byte index vs rune index
s := "Hello, 世界"
fmt.Println(s[7])          // 228 — first byte of "世"
fmt.Printf("%c\n", s[7])  // not "世" — garbled output!

// Correct: convert to rune slice first
runes := []rune(s)
fmt.Printf("%c\n", runes[7]) // 世

// Tricky 2: String slice shares backing memory
big := strings.Repeat("x", 1000)
small := big[:5]  // small holds reference to 1000-byte array
// big cannot be GC'd while small is in scope

// Tricky 3: Range gives byte positions, not rune positions
s2 := "世界"
for i, r := range s2 {
    fmt.Println(i, r)  // 0 19990 then 3 30028
}
```

---

## 22. Test

```go
package strings_test

import (
    "strings"
    "testing"
    "unicode/utf8"
)

func TestStringByteCount(t *testing.T) {
    s := "Hello, 世界"
    if len(s) != 13 {
        t.Errorf("expected 13 bytes, got %d", len(s))
    }
}

func TestStringRuneCount(t *testing.T) {
    s := "Hello, 世界"
    if utf8.RuneCountInString(s) != 9 {
        t.Errorf("expected 9 runes, got %d", utf8.RuneCountInString(s))
    }
}

func TestStringBuilder(t *testing.T) {
    var sb strings.Builder
    for i := 0; i < 3; i++ {
        sb.WriteString("x")
    }
    if sb.String() != "xxx" {
        t.Errorf("expected xxx, got %s", sb.String())
    }
}

func TestStringsContains(t *testing.T) {
    if !strings.Contains("Hello World", "World") {
        t.Error("expected Contains to return true")
    }
    if strings.Contains("Hello World", "world") {
        t.Error("Contains should be case sensitive")
    }
}

func TestTrimSpace(t *testing.T) {
    if strings.TrimSpace("  hi  ") != "hi" {
        t.Error("TrimSpace failed")
    }
    if strings.TrimSpace("") != "" {
        t.Error("TrimSpace on empty should return empty")
    }
}
```

---

## 23. Tricky Questions

**Q: What does `len("Hello, 世界")` return?**
A: 13 — `len()` counts bytes, and each Chinese character uses 3 bytes in UTF-8.

**Q: Can you change a single character in a Go string?**
A: Not directly. You must convert to `[]byte`, modify, and convert back with `string()`.

**Q: Is `s := ""` the same as `var s string`?**
A: Yes. Both produce the zero value for string, which is an empty string `""`.

**Q: What is the difference between `byte` and `rune`?**
A: `byte` is `uint8` (0–255), used for ASCII. `rune` is `int32`, used for Unicode code points.

**Q: What happens when you iterate a string with `range`?**
A: Range decodes UTF-8 runes. The loop variable `i` is the byte offset, `r` is the rune value.

**Q: Why is `+` concatenation in a loop slow?**
A: Each `+` allocates a new string and copies all previous bytes, giving O(n^2) total work.

---

## 24. Cheat Sheet

```go
// Declare
s := "hello"
s2 := `raw\nliteral`

// Length
len(s)                              // byte count
utf8.RuneCountInString(s)           // rune/character count

// Slice
s[1:3]                              // bytes at index 1 and 2

// Iterate runes safely
for i, r := range s { ... }

// Convert
b := []byte(s)                      // string -> []byte (copy)
s = string(b)                       // []byte -> string (copy)
r := []rune(s)                      // string -> []rune (copy)

// Efficient building
var sb strings.Builder
sb.WriteString("hello")
sb.WriteByte('!')
result := sb.String()

// strings package
strings.Contains(s, sub)
strings.HasPrefix(s, prefix)
strings.HasSuffix(s, suffix)
strings.Count(s, substr)
strings.Index(s, substr)            // -1 if not found
strings.ToUpper(s)
strings.ToLower(s)
strings.TrimSpace(s)
strings.Trim(s, cutset)
strings.Split(s, sep)
strings.Join(slice, sep)
strings.Replace(s, old, new, n)
strings.ReplaceAll(s, old, new)
strings.Cut(s, sep)                 // before, after, found
strings.EqualFold(s1, s2)           // case-insensitive equal
strings.Repeat(s, n)
strings.Fields(s)                   // split by whitespace
```

---

## 25. Self-Assessment

Rate your understanding (1 = novice, 5 = expert):

- [ ] I understand that `len()` returns bytes, not characters
- [ ] I can iterate strings correctly using `range`
- [ ] I know when to use `[]byte` vs `string`
- [ ] I can use `strings.Builder` for efficient concatenation
- [ ] I know the most common `strings` package functions
- [ ] I understand UTF-8 encoding basics
- [ ] I can explain why strings are immutable in Go
- [ ] I know how to correctly count Unicode characters

---

## 26. Summary

Go strings are immutable byte sequences with a simple two-word header (pointer + length). They are natively UTF-8, but `len()` works on bytes. For character-level operations, use `range` (which yields runes) or the `unicode/utf8` package. The `strings` package provides all common string manipulation functions. For efficient string building, always use `strings.Builder` instead of the `+` operator in loops.

---

## 27. What You Can Build

With solid string knowledge, you can build:

- CSV and TSV parsers
- Simple tokenizers and lexers
- URL routing (matching path patterns)
- Template engines
- Log formatters
- Input validators
- Text search utilities
- String-based encoders/decoders
- Configuration file parsers
- Command-line argument processors

---

## 28. Further Reading

- [Go Blog: Strings, bytes, runes and characters](https://go.dev/blog/strings)
- [Go standard library: strings package](https://pkg.go.dev/strings)
- [Go standard library: unicode/utf8 package](https://pkg.go.dev/unicode/utf8)
- [Go spec: String types](https://go.dev/ref/spec#String_types)
- [Effective Go: Strings](https://go.dev/doc/effective_go)

---

## 29. Related Topics

- `[]byte` slices — mutable byte sequences
- `rune` type — Unicode code points
- `fmt` package — string formatting with verbs
- `strconv` package — string/number conversions
- `regexp` package — regular expressions on strings
- `io` and `bufio` — streaming string processing
- `encoding/json` — JSON encoding/decoding
- `text/template` — text templating

---

## 30. Diagrams

### String Memory Layout

```
var s string = "Hello"

Stack:           Heap:
+--------+       +---+---+---+---+---+
| ptr ———+——————>| H | e | l | l | o |
| len=5  |       +---+---+---+---+---+
+--------+
```

### UTF-8 Encoding

```
Character | UTF-8 Bytes (hex)
----------|------------------------------
A         | 41              (1 byte)
e-acute   | C3 A9           (2 bytes)
world(世) | E4 B8 96        (3 bytes)
emoji     | F0 9F 98 80     (4 bytes)
```

### String Slice Sharing Backing Array

```
big := "Hello, World, and more..."
        ^                        ^
        ptr                    len=25

small := big[0:5]
          ^    ^
          ptr  len=5     (same backing array, no copy!)
```

### strings.Builder Growth Pattern

```
sb.WriteString("Go"):   [G|o|_|_|_|_|_|_]  len=2,  cap=8
sb.WriteString(" is"):  [G|o| |i|s|_|_|_]  len=5,  cap=8
sb.WriteString(" fun"): [G|o| |i|s| |f|u]  len=8,  cap=8
sb.WriteString("!"):    [G|o| |i|s| |f|u|n| |!|_|_|_|_|_|_]  cap=16 (doubled)
```
