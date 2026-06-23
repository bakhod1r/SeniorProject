# Strings in Go — Junior Level

## 1. Introduction

Strings are one of the most fundamental data types in any programming language. In Go, a string is an **immutable sequence of bytes**. That single phrase — immutable sequence of bytes — contains everything you need to understand about how strings work in Go.

Unlike some other languages where strings are sequences of characters, Go strings are sequences of **bytes**. This distinction matters when you work with non-ASCII text like Chinese, Arabic, or emoji characters.

---

## 2. Prerequisites

Before learning Go strings, you should be comfortable with:
- Basic Go syntax (variables, functions, `fmt.Println`)
- The concept of types in Go (`int`, `bool`, `float64`)
- How to run a Go program (`go run main.go`)
- Basic understanding of ASCII (letter 'A' = number 65)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **String** | An immutable sequence of bytes in Go |
| **Byte** | A single 8-bit value (0–255), same as `uint8` |
| **Rune** | A Unicode code point, same as `int32` |
| **UTF-8** | A variable-width encoding for Unicode characters |
| **Immutable** | Cannot be changed after creation |
| **Zero value** | The default value of a type; for strings it is `""` |
| **String literal** | A string written directly in source code |
| **Backtick** | The `` ` `` character, used for raw string literals |
| **Escape sequence** | Special characters like `\n` (newline) or `\t` (tab) |
| **Concatenation** | Joining two strings together |
| **Substring** | A portion of a string |

---

## 4. Core Concepts

### Strings are Immutable Byte Sequences

```go
s := "Hello, Go!"
// s is now a sequence of 10 bytes
// You CANNOT do: s[0] = 'h'  — this is a compile error
```

### The Two Types of String Literals

```go
// Interpreted string literal (double quotes)
s1 := "Hello\nWorld"  // \n becomes a real newline

// Raw string literal (backticks)
s2 := `Hello\nWorld`  // \n stays as two characters: \ and n
```

### `len()` Returns Byte Count

```go
s := "Hello"
fmt.Println(len(s)) // 5 — five bytes

emoji := "😀"
fmt.Println(len(emoji)) // 4 — emoji takes 4 bytes in UTF-8!
```

### Accessing Bytes with Index

```go
s := "Hello"
fmt.Println(s[0]) // 72 — the byte value of 'H'
fmt.Printf("%c\n", s[0]) // H — formatted as character
```

### String Slicing

```go
s := "Hello, World!"
sub := s[7:12] // "World"
fmt.Println(sub)
```

---

## 5. Real-World Analogies

**Think of a string like a bead necklace:**
- Each bead is a byte
- The necklace (string) cannot be modified — you can't replace a bead
- You can make a NEW necklace by combining parts of old ones
- You can look at any bead (index), but can't change it

**Think of UTF-8 strings like a book in different languages:**
- English letters take 1 page each
- Chinese characters take 2-4 pages each
- When you count "pages" (bytes), it's different from counting "words" (characters)

---

## 6. Mental Models

**Model 1: String as a Read-Only Byte Array**
```
s := "Go"
        ┌───┬───┐
Index:  │ 0 │ 1 │
Value:  │ 71│111│  (G=71, o=111 in ASCII)
        └───┴───┘
```

**Model 2: String's Internal Structure**
```
String header:
┌──────────────┬──────┐
│  ptr to data │  len │
└──────────────┴──────┘
       │
       ▼
  ┌─────────────────┐
  │ H e l l o , ...│  (actual bytes in memory)
  └─────────────────┘
```

---

## 7. Pros & Cons

### Pros
- **Immutability** makes strings safe to share between goroutines
- **Efficient slicing** — substrings share memory with original
- **UTF-8 by convention** — works naturally with international text
- **Simple and predictable** — no hidden complexity for ASCII text

### Cons
- **Byte vs character confusion** — `len("😀")` is 4, not 1
- **Cannot modify in place** — every "modification" creates a new string
- **`+` concatenation is slow** in loops — each `+` allocates memory
- **Index gives bytes, not characters** — `s[0]` is a byte, not a rune

---

## 8. Use Cases

1. **Storing names, emails, messages** — everyday text data
2. **File paths** — `"/home/user/documents/file.txt"`
3. **JSON keys and values** — `"name"`, `"age"`
4. **HTTP request/response bodies**
5. **Log messages** — `"Error: connection refused"`
6. **SQL queries** — `"SELECT * FROM users WHERE id = ?"`
7. **Regular expressions** — `"^[a-z]+$"`
8. **HTML/XML templates**
9. **Configuration values** — `"localhost:8080"`
10. **Command-line arguments**

---

## 9. Code Examples

### Example 1: Basic String Operations

```go
package main

import "fmt"

func main() {
    // Declaring strings
    var name string           // zero value: ""
    name = "Alice"
    greeting := "Hello, " + name + "!"

    fmt.Println(greeting)           // Hello, Alice!
    fmt.Println(len(greeting))      // 13
    fmt.Println(greeting[0])        // 72 (byte value of 'H')
    fmt.Printf("%c\n", greeting[0]) // H

    // Slicing
    fmt.Println(greeting[7:12]) // Alice
    fmt.Println(greeting[:5])   // Hello
    fmt.Println(greeting[7:])   // Alice!
}
```

### Example 2: Iterating Over a String

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"

    // Iterating by BYTE (index)
    fmt.Println("By bytes:")
    for i := 0; i < len(s); i++ {
        fmt.Printf("  s[%d] = %d (%c)\n", i, s[i], s[i])
    }

    // Iterating by RUNE (Unicode character)
    fmt.Println("\nBy runes:")
    for i, r := range s {
        fmt.Printf("  index=%d rune=%d (%c)\n", i, r, r)
    }
}
```

Output:
```
By bytes:
  s[0] = 72 (H)
  s[1] = 101 (e)
  ...
  s[7] = 228 (ä)  ← first byte of '世'

By runes:
  index=0 rune=72 (H)
  ...
  index=7 rune=19990 (世)   ← full Unicode character
  index=10 rune=30028 (界)
```

### Example 3: Using the `strings` Package

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    s := "  Hello, Go World!  "

    // Trimming
    trimmed := strings.TrimSpace(s)
    fmt.Println(trimmed) // "Hello, Go World!"

    // Case conversion
    fmt.Println(strings.ToUpper(trimmed)) // "HELLO, GO WORLD!"
    fmt.Println(strings.ToLower(trimmed)) // "hello, go world!"

    // Searching
    fmt.Println(strings.Contains(trimmed, "Go"))    // true
    fmt.Println(strings.HasPrefix(trimmed, "Hello")) // true
    fmt.Println(strings.HasSuffix(trimmed, "!"))     // true
    fmt.Println(strings.Index(trimmed, "Go"))        // 7

    // Replacing
    replaced := strings.Replace(trimmed, "Go", "Golang", 1)
    fmt.Println(replaced) // "Hello, Golang World!"

    // Splitting and joining
    words := strings.Split(trimmed, " ")
    fmt.Println(words)                      // [Hello, Go World!]
    fmt.Println(strings.Join(words, "-"))   // Hello,-Go-World!
}
```

---

## 10. Coding Patterns

### Pattern 1: Build Strings Efficiently with `strings.Builder`

```go
// BAD: creates a new string on each iteration
result := ""
for i := 0; i < 1000; i++ {
    result += "x"  // 1000 allocations!
}

// GOOD: uses a buffer, only one allocation at the end
var b strings.Builder
for i := 0; i < 1000; i++ {
    b.WriteByte('x')
}
result := b.String()
```

### Pattern 2: Check Before You Access

```go
// SAFE way to get first character
func firstChar(s string) byte {
    if len(s) == 0 {
        return 0
    }
    return s[0]
}
```

### Pattern 3: Convert Between `string` and `[]byte`

```go
s := "Hello"
b := []byte(s)     // string → []byte (copies data)
b[0] = 'h'         // now we CAN modify
s2 := string(b)    // []byte → string (copies data)
fmt.Println(s2)    // "hello"
```

---

## 11. Clean Code

```go
// BAD: unclear variable names, magic string operations
func processData(x string) string {
    return x[2:len(x)-2]
}

// GOOD: clear intent, named constants, documented
// trimBrackets removes the first and last 2 characters
// (brackets) from the input string.
func trimBrackets(s string) string {
    const bracketWidth = 2
    if len(s) < bracketWidth*2 {
        return s
    }
    return s[bracketWidth : len(s)-bracketWidth]
}
```

---

## 12. Product Use / Feature Examples

| Product | String Usage |
|---------|-------------|
| **Search engine** | Indexing and searching text documents |
| **Chat app** | Storing and displaying messages |
| **Email client** | Parsing email addresses and subjects |
| **Web server** | Processing URL paths and query parameters |
| **Database** | Column names, table names, SQL queries |
| **Config file parser** | Reading key=value pairs |
| **Log aggregator** | Parsing and filtering log lines |

---

## 13. Error Handling

```go
// Strings themselves don't cause errors, but operations can panic
// Common: index out of range
func safeIndex(s string, i int) (byte, error) {
    if i < 0 || i >= len(s) {
        return 0, fmt.Errorf("index %d out of range for string of length %d", i, len(s))
    }
    return s[i], nil
}

// Common: conversion errors
func parsePort(s string) (int, error) {
    port, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("invalid port %q: %w", s, err)
    }
    if port < 1 || port > 65535 {
        return 0, fmt.Errorf("port %d out of valid range [1, 65535]", port)
    }
    return port, nil
}
```

---

## 14. Security Considerations

- **SQL injection**: Never concatenate user input into SQL strings. Use parameterized queries.
  ```go
  // DANGEROUS
  query := "SELECT * FROM users WHERE name = '" + userInput + "'"

  // SAFE
  query := "SELECT * FROM users WHERE name = ?"
  db.Query(query, userInput)
  ```

- **Path traversal**: User-supplied file paths can escape the intended directory.
  ```go
  // Check path is within allowed directory
  if !strings.HasPrefix(cleanPath, allowedDir) {
      return errors.New("path traversal detected")
  }
  ```

- **Log injection**: User input in log messages can forge log entries. Sanitize or quote user data.

---

## 15. Performance Tips

1. **Use `strings.Builder`** for concatenating many strings
2. **Use `bytes.Buffer`** when mixing string and byte operations
3. **Avoid `+` in loops** — each `+` creates a new allocation
4. **`strings.Contains` is O(n)** — consider pre-processing for repeated searches
5. **String slicing is free** — no memory allocation, shares underlying array

```go
// Benchmark comparison: + vs Builder
// + operator: ~1000x slower for 10,000 concatenations
// strings.Builder: near O(n) total cost
```

---

## 16. Metrics & Analytics

When working with strings in production:
- Monitor string allocation rates (visible in `pprof` heap profiles)
- Log lengths of incoming user strings to detect abuse
- Track encoding errors when converting from external input

```go
// Track string sizes for monitoring
func trackMessageSize(msg string) {
    messageSize.Observe(float64(len(msg))) // Prometheus histogram
}
```

---

## 17. Best Practices

1. Use `strings.Builder` for loops, not `+`
2. Always check `len(s) > 0` before accessing `s[0]`
3. Use `range` loop to iterate by rune (Unicode character), not byte
4. Prefer `strings.EqualFold(a, b)` for case-insensitive comparison (not `strings.ToLower(a) == strings.ToLower(b)`)
5. Use `fmt.Sprintf` for formatting, not manual concatenation
6. Document whether a function expects/returns UTF-8 text or arbitrary bytes

---

## 18. Edge Cases & Pitfalls

```go
// Pitfall 1: len() returns bytes, not characters
emoji := "😀"
fmt.Println(len(emoji)) // 4, not 1!

// Pitfall 2: Slicing by byte can split a multi-byte character
s := "Hello, 世界"
fmt.Println(s[:8]) // might print garbled text or panic if in the middle of a rune

// Pitfall 3: Comparing with == is fine, but case matters
fmt.Println("Go" == "go") // false

// Pitfall 4: Empty string is not nil (unlike some languages)
var s string
fmt.Println(s == "") // true
fmt.Println(s == nil) // compile error: cannot compare string to nil
```

---

## 19. Common Mistakes

```go
// Mistake 1: Using s[i] to get a character (gives byte value)
s := "A"
fmt.Println(s[0] == 'A') // true, works for ASCII
fmt.Println(s[0] == "A") // compile error: comparing byte to string

// Mistake 2: Modifying a string in-place
s := "hello"
// s[0] = 'H'  // compile error: cannot assign to s[0]

// Mistake 3: Using + in a loop
result := ""
for _, word := range words {
    result += word + " " // SLOW for large slices
}
// Fix: use strings.Join(words, " ")

// Mistake 4: Ignoring the difference between bytes and runes
name := "José"
fmt.Println(len(name))          // 5 (é is 2 bytes)
fmt.Println(len([]rune(name)))  // 4 (4 characters)
```

---

## 20. Common Misconceptions

| Misconception | Reality |
|--------------|---------|
| `len(s)` counts characters | `len(s)` counts **bytes** |
| Strings can be modified | Strings are **immutable** |
| `s[i]` gives a character | `s[i]` gives a **byte** (`uint8`) |
| `""` and `nil` are the same | Go strings can't be `nil`; zero value is `""` |
| Strings are always valid UTF-8 | Go strings can hold any bytes |

---

## 21. Tricky Points

```go
// Tricky: empty string has valid zero-length slice
s := ""
sub := s[0:0] // valid: empty substring
fmt.Println(sub == "") // true

// Tricky: converting []byte back to string copies data
b := []byte{72, 101, 108, 108, 111}
s := string(b)
b[0] = 0  // does NOT affect s
fmt.Println(s) // still "Hello"

// Tricky: string(65) is NOT "65", it's "A"
fmt.Println(string(65))  // "A" — treats 65 as a Unicode code point
fmt.Println(fmt.Sprint(65)) // "65" — formats the number
```

---

## 22. Test

```go
package main

import (
    "strings"
    "testing"
)

func TestStringLength(t *testing.T) {
    tests := []struct {
        input    string
        wantBytes int
        wantRunes int
    }{
        {"Hello", 5, 5},
        {"😀", 4, 1},
        {"世界", 6, 2},
        {"", 0, 0},
    }

    for _, tt := range tests {
        gotBytes := len(tt.input)
        gotRunes := len([]rune(tt.input))
        if gotBytes != tt.wantBytes {
            t.Errorf("len(%q) = %d, want %d", tt.input, gotBytes, tt.wantBytes)
        }
        if gotRunes != tt.wantRunes {
            t.Errorf("rune count of %q = %d, want %d", tt.input, gotRunes, tt.wantRunes)
        }
    }
}

func TestStringContains(t *testing.T) {
    if !strings.Contains("Hello, World!", "World") {
        t.Error("expected 'World' to be in 'Hello, World!'")
    }
}
```

---

## 23. Tricky Questions

**Q1: What does `len("café")` return?**
A: `5` — 'c', 'a', 'f' are 1 byte each, 'é' is 2 bytes.

**Q2: Can you assign `nil` to a string variable?**
A: No. Strings cannot be `nil` in Go. The zero value is `""`.

**Q3: What is the type of `s[0]` where `s` is a `string`?**
A: `byte` (which is an alias for `uint8`).

**Q4: Does `s[1:3]` allocate new memory?**
A: No. String slicing creates a new string header (ptr + len) pointing into the same underlying byte array.

**Q5: What happens if you do `string(72)`?**
A: You get `"H"` — Go interprets the integer as a Unicode code point (72 = 'H').

---

## 24. Cheat Sheet

```go
// Declaration
s := "hello"
var s string  // zero value: ""

// Length (bytes!)
len(s)

// Byte access
s[0]           // returns byte (uint8)

// Slicing
s[1:4]         // bytes 1,2,3
s[:3]          // first 3 bytes
s[3:]          // from byte 3 to end

// Concatenation
s1 + s2                        // simple, slow for loops
fmt.Sprintf("%s %s", s1, s2)   // formatted
strings.Join([]string{s1,s2}, " ")  // from slice

// Conversion
[]byte(s)       // string → byte slice (copies)
string(b)       // []byte → string (copies)
[]rune(s)       // string → rune slice (copies)

// strings package essentials
strings.Contains(s, sub)
strings.HasPrefix(s, pre)
strings.HasSuffix(s, suf)
strings.ToUpper(s)
strings.ToLower(s)
strings.TrimSpace(s)
strings.Split(s, sep)
strings.Join(parts, sep)
strings.Replace(s, old, new, n)
strings.Index(s, sub)
strings.Count(s, sub)
strings.Fields(s)           // split on whitespace

// Efficient building
var b strings.Builder
b.WriteString("hello")
b.WriteByte('\n')
result := b.String()

// Range loop (by rune)
for i, r := range s {
    // i = byte index, r = rune value
}
```

---

## 25. Self-Assessment Checklist

- [ ] I can declare a string variable and assign a value
- [ ] I understand that `len(s)` returns bytes, not characters
- [ ] I can access a specific byte using `s[i]`
- [ ] I can create a substring using `s[a:b]`
- [ ] I know why strings are immutable in Go
- [ ] I can use `strings.Contains`, `strings.Split`, `strings.Join`
- [ ] I understand the difference between `for i := range` and `for i, r := range`
- [ ] I can convert between `string` and `[]byte`
- [ ] I know how to use `strings.Builder` for efficient concatenation
- [ ] I understand the difference between raw and interpreted string literals

---

## 26. Summary

In Go, strings are **immutable sequences of bytes**. The key things to remember:
1. `len(s)` returns **byte count** (not character count)
2. `s[i]` returns a **byte** (not a character)
3. Use `range` to iterate by **Unicode rune** (character)
4. Use `strings.Builder` for **efficient concatenation** in loops
5. Use the `strings` package for all common string operations
6. Convert to `[]byte` when you need to **modify** a string

---

## 27. What You Can Build

With a solid understanding of Go strings, you can build:
- **Text processors** — word counters, search/replace tools
- **CSV/log parsers** — split lines, extract fields
- **Simple web servers** — parse URL paths, query strings
- **Template engines** — fill in placeholders in text templates
- **Password validators** — check length, character types
- **Username sanitizers** — trim spaces, lowercase, validate characters

---

## 28. Further Reading

- [Go Spec: String Types](https://go.dev/ref/spec#String_types)
- [Go Blog: Strings, bytes, runes and characters in Go](https://go.dev/blog/strings)
- [strings package documentation](https://pkg.go.dev/strings)
- [strconv package documentation](https://pkg.go.dev/strconv)
- [Go by Example: Strings](https://gobyexample.com/strings)

---

## 29. Related Topics

- **Runes** — Unicode code points (`int32`), for character-level operations
- **[]byte** — mutable byte slices, for binary data and modification
- **fmt package** — formatting strings with `Sprintf`, `Printf`
- **strconv package** — converting between strings and numbers
- **unicode package** — Unicode character classification (`IsLetter`, `IsDigit`)
- **io.Reader / io.Writer** — reading/writing strings as streams
- **Regular expressions** — `regexp` package for pattern matching

---

## 30. Diagrams & Visual Aids

### String Memory Layout
```
var s string = "Hello"

Stack:                    Heap (read-only data):
┌──────────────┐         ┌───┬───┬───┬───┬───┐
│ ptr ─────────┼────────►│ H │ e │ l │ l │ o │
│ len = 5      │         └───┴───┴───┴───┴───┘
└──────────────┘          [0] [1] [2] [3] [4]

Substring s[1:4] = "ell"
Stack:                    (same heap data!)
┌──────────────┐
│ ptr ─────────┼────────► points to index [1]
│ len = 3      │
└──────────────┘
```

### Byte vs Rune Indexing
```
String: "Go世界"

Bytes:  G  o  世(3 bytes)    界(3 bytes)
Index:  0  1  2  3  4  5  6  7  8

Runes:  G  o  世            界
Index:  0  1  2             3
(via range loop)
```

### strings Package Quick Reference
```
┌─────────────────────────────────────────────────┐
│               strings Package                    │
├─────────────────────┬───────────────────────────┤
│ Search              │ Contains, HasPrefix,        │
│                     │ HasSuffix, Index,           │
│                     │ LastIndex, Count            │
├─────────────────────┼───────────────────────────┤
│ Transform           │ ToUpper, ToLower,           │
│                     │ Title, TrimSpace, Trim      │
├─────────────────────┼───────────────────────────┤
│ Split/Join          │ Split, Fields, Join         │
├─────────────────────┼───────────────────────────┤
│ Replace             │ Replace, ReplaceAll         │
├─────────────────────┼───────────────────────────┤
│ Build               │ Builder, NewReader          │
└─────────────────────┴───────────────────────────┘
```
