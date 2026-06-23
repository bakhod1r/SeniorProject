# Interpreted String Literals in Go — Middle Level

## 1. Introduction

At the middle level, interpreted string literals are analyzed beyond their basic escape sequences. We examine the full set of numeric escapes, the interaction with Unicode, performance characteristics, and how they compare to raw strings across different use cases. The middle engineer knows not just what escape sequences do, but why they exist and when each form is appropriate.

---

## 2. Prerequisites

- Solid understanding of Go strings (immutability, byte vs rune)
- Familiarity with Unicode and UTF-8 encoding
- Experience with `fmt`, `strconv`, `unicode/utf8` packages
- Understanding of Go's memory model
- Comfortable with Go testing

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Interpreted string literal** | A double-quoted string with compile-time escape processing |
| **Escape sequence** | A backslash + character combination representing a single value |
| **Code point** | A Unicode integer (U+0041 = 'A') |
| **UTF-8** | Variable-width Unicode encoding: ASCII uses 1 byte, others 2-4 bytes |
| **CRLF** | `\r\n` — Windows line endings (Carriage Return + Line Feed) |
| **Octal** | Base-8 number system used in `\ooo` escape sequences |
| **Hex** | Base-16 number system used in `\xHH` escape sequences |
| **BOM** | Byte Order Mark (`\ufeff`) — used to indicate text encoding |
| **ANSI escape codes** | Terminal control sequences starting with `\x1b[` |

---

## 4. Core Concepts (Deep Dive)

### Complete Escape Sequence Specification

Per the Go specification, interpreted string literals support:

```
Escape   Value    Unicode    Notes
─────────────────────────────────────────────────────────────
\a       0x07     U+0007     Alert (bell)
\b       0x08     U+0008     Backspace
\f       0x0C     U+000C     Form feed
\n       0x0A     U+000A     Newline (line feed)
\r       0x0D     U+000D     Carriage return
\t       0x09     U+0009     Horizontal tab
\v       0x0B     U+000B     Vertical tab
\\       0x5C     U+005C     Backslash
\'       0x27     U+0027     Single quote (used in rune literals)
\"       0x22     U+0022     Double quote (only valid in strings)
\ooo     byte     —          Octal: 3 octal digits (000-377)
\xHH     byte     —          Hex: exactly 2 hex digits
\uXXXX   rune     —          Unicode: exactly 4 hex digits (UTF-8 encoded)
\UXXXXXXXX rune   —          Unicode: exactly 8 hex digits (UTF-8 encoded)
```

### \u vs \U vs \x

```go
// \uXXXX — Unicode code point (4 hex digits, range U+0000 to U+FFFF)
s1 := "\u4e2d"    // 中 (U+4E2D, 3 bytes in UTF-8: e4 b8 ad)
len(s1) == 3      // bytes, not characters

// \UXXXXXXXX — Unicode code point (8 hex digits, range U+000000 to U+10FFFF)
s2 := "\U0001F600" // 😀 (U+1F600, 4 bytes in UTF-8: f0 9f 98 80)
len(s2) == 4       // 4 bytes

// \xHH — a single byte (NOT necessarily a complete Unicode character)
s3 := "\xe4\xb8\xad"  // 中 (3 separate hex escapes = 3 bytes = valid UTF-8 for 中)
s1 == s3              // true — same bytes

// KEY DIFFERENCE: \u and \U are Unicode-aware, produce valid UTF-8
// \x is raw bytes — you can produce invalid UTF-8
s4 := "\xff"  // single byte 0xFF — not valid UTF-8
```

### Octal Escapes

```go
// Octal escapes are rarely used in modern Go code
// but appear in older code and C-translated code

"\101" == "A"   // true: 101 octal = 65 decimal = 'A'
"\012" == "\n"  // true: 012 octal = 10 decimal = newline
"\000" == "\x00" // true: null byte

// Octal range is 0-377 (0-255 in decimal, which matches a byte)
// "\400" would be invalid (octal 400 = decimal 256, too large for a byte)
```

---

## 5. Evolution

Interpreted string literals with escape sequences have been part of Go from the start (pre-1.0). The design closely mirrors C string literals, which was deliberate — Go was designed to be familiar to C/Unix programmers.

The escape sequences in Go are essentially a subset of C's, with some differences:
- Go doesn't support `\?` (C's `?` escape for digraphs)
- Go adds `\uXXXX` and `\UXXXXXXXX` for Unicode (C only has `\uXXXX` in C11)
- Go's `\xHH` is always exactly 2 hex digits (C allows variable length)

---

## 6. Why Interpreted Strings Work This Way

### Why Compile-Time Processing?

Escape sequences are processed at compile time because:
1. **Zero runtime cost** — `"\n"` is stored as one byte, not two
2. **Efficiency** — strings in `.rodata` are smaller than if escapes were left as-is
3. **Predictability** — the string's content is fixed and knowable from source code

### Why \x Takes Exactly 2 Digits?

In C, `\x` takes any number of hex digits, which leads to ambiguity: is `"\xABCD"` one byte (0xAB) followed by "CD", or the four-byte sequence? Go's strict "exactly 2 digits" rule eliminates this ambiguity.

### Why Both \u and \U?

- `\uXXXX` covers the Basic Multilingual Plane (U+0000 to U+FFFF) — sufficient for most text
- `\UXXXXXXXX` is needed for supplementary characters (U+10000+) like emoji, musical symbols, rare CJK characters

---

## 7. Alternative Approaches

### Choosing Between \u, \x, and Direct Character

```go
// Three ways to embed 'é' (U+00E9):
s1 := "caf\u00e9"    // Unicode escape — most readable for Latin chars
s2 := "caf\xc3\xa9"  // Hex bytes (UTF-8 encoding of U+00E9) — for binary-level control
s3 := "café"          // Direct — most readable, requires UTF-8 source file
// All three are identical at runtime

// When to use each:
// - Direct: whenever possible (source file is UTF-8)
// - \u: when documenting which Unicode character is intended
// - \x: when working with specific byte patterns (binary protocols)
```

### When NOT to Use Interpreted Strings

```go
// Use raw strings when:
// 1. String has many backslashes (regex, Windows paths)
re := regexp.MustCompile(`\d+\.\d+`)  // NOT "\\d+\\.\\d+"

// 2. String spans multiple lines and readability matters
sql := `
    SELECT *
    FROM users
`  // NOT "\\n    SELECT *\\n    FROM users\\n"

// 3. Embedded quotes with surrounding quotes
// msg := "She said \"it's \"complicated\"\""  // getting messy
msg := `She said "it's 'complicated'"`  // clean
```

---

## 8. Anti-Patterns

```go
// Anti-pattern 1: Using \x to encode UTF-8 manually when \u is available
// BAD: hard to understand what character this is
s := "\xe4\xb8\xad"  // 中

// GOOD: use \u or just the character directly
s = "\u4e2d"  // clearly documents the intended Unicode character
s = "中"      // most readable if source is UTF-8

// Anti-pattern 2: Embedding binary data in interpreted strings
// BAD: binary blobs in source code
cert := "\x30\x82\x04\x24..."  // hundreds of hex bytes

// GOOD: use go:embed or load from a file
//go:embed certs/root.pem
var rootCert string

// Anti-pattern 3: Hard-coding ANSI codes inline
fmt.Print("\x1b[1;31mError:\x1b[0m " + msg)

// GOOD: use named constants
const (
    Red   = "\x1b[31m"
    Bold  = "\x1b[1m"
    Reset = "\x1b[0m"
)
fmt.Print(Bold + Red + "Error:" + Reset + " " + msg)
```

---

## 9. Pros & Cons (Deeper Analysis)

### Interpreted String Advantages in Practice

```go
// 1. Single-line strings with control characters are compact
header := "Content-Type: application/json\r\n"
// vs raw string (would need to put actual CR+LF in source!)

// 2. Documenting exact byte values
separator := "\x1f"  // ASCII Unit Separator — commonly used in data interchange

// 3. Unicode identification
copyright := "\u00a9 2024 Company Name"  // © clearly identified
```

### When Readability Suffers

```go
// Complex Windows registry path — interpreted:
regPath := "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"

// Same path — raw string (much clearer):
regPath = `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion`

// Threshold: if you have 3+ backslashes, use a raw string
```

---

## 10. Real-World Use Cases

### Use Case 1: HTTP Protocol Implementation

```go
// HTTP uses CRLF (\r\n) for line endings
func buildHTTPRequest(method, path, host string, body string) string {
    var b strings.Builder
    b.WriteString(method + " " + path + " HTTP/1.1\r\n")
    b.WriteString("Host: " + host + "\r\n")
    b.WriteString("Content-Type: application/json\r\n")
    b.WriteString("Content-Length: " + strconv.Itoa(len(body)) + "\r\n")
    b.WriteString("\r\n")
    b.WriteString(body)
    return b.String()
}
```

### Use Case 2: Binary Protocol

```go
// Redis RESP protocol uses \r\n separators
func redisCommand(cmd string, args ...string) []byte {
    var b strings.Builder
    b.WriteString(fmt.Sprintf("*%d\r\n", len(args)+1))
    b.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(cmd), cmd))
    for _, arg := range args {
        b.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(arg), arg))
    }
    return []byte(b.String())
}
```

### Use Case 3: ANSI Terminal Output

```go
package terminal

const (
    Reset     = "\x1b[0m"
    Bold      = "\x1b[1m"
    Dim       = "\x1b[2m"
    Underline = "\x1b[4m"
    Red       = "\x1b[31m"
    Green     = "\x1b[32m"
    Yellow    = "\x1b[33m"
    Blue      = "\x1b[34m"
    White     = "\x1b[37m"
)

func ColorRed(s string) string    { return Red + s + Reset }
func ColorGreen(s string) string  { return Green + s + Reset }
func ColorYellow(s string) string { return Yellow + s + Reset }
```

---

## 11. Code Examples

### Example 1: All Numeric Escape Types

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    // Hex escapes
    ascii := "\x41\x42\x43" // "ABC"
    fmt.Printf("hex:   %q (%d bytes)\n", ascii, len(ascii))

    // Octal escapes
    octal := "\101\102\103" // "ABC" (101, 102, 103 octal = 65, 66, 67 decimal)
    fmt.Printf("octal: %q (%d bytes)\n", octal, len(octal))
    fmt.Println("hex == octal:", ascii == octal) // true

    // Unicode 4-digit
    u4 := "\u4e2d\u6587" // 中文
    fmt.Printf("\\u:    %s (%d bytes, %d runes)\n",
        u4, len(u4), utf8.RuneCountInString(u4))

    // Unicode 8-digit
    u8 := "\U0001F600\U0001F4AA" // 😀💪
    fmt.Printf("\\U:    %s (%d bytes, %d runes)\n",
        u8, len(u8), utf8.RuneCountInString(u8))

    // Mixed in one string
    mixed := "A\u00e9\U0001F600"
    fmt.Printf("mixed: %s (%d bytes)\n", mixed, len(mixed))
    // A=1 byte, é=2 bytes, 😀=4 bytes → 7 bytes total
}
```

### Example 2: Escape Sequences in Parsing

```go
package main

import (
    "fmt"
    "strings"
)

// ParseEscape converts Go-style escape sequences in a plain string
// (useful when reading strings from user input that contain \n, \t etc.)
func parseEscapes(s string) string {
    s = strings.ReplaceAll(s, `\n`, "\n")
    s = strings.ReplaceAll(s, `\t`, "\t")
    s = strings.ReplaceAll(s, `\r`, "\r")
    s = strings.ReplaceAll(s, `\\`, "\\")
    return s
}

func main() {
    // User types "hello\nworld" (literally, with backslash-n)
    userInput := `hello\nworld\t!`
    parsed := parseEscapes(userInput)
    fmt.Printf("Input:  %q\n", userInput)  // "hello\\nworld\\t!"
    fmt.Printf("Parsed: %q\n", parsed)     // "hello\nworld\t!"
}
```

### Example 3: Building Binary Data with Escape Sequences

```go
package main

import "fmt"

// buildVarint creates a Protocol Buffers-style variable-length integer
func buildVarint(n int) string {
    var bytes []byte
    for n > 127 {
        bytes = append(bytes, byte(n&0x7f)|0x80)
        n >>= 7
    }
    bytes = append(bytes, byte(n))
    return string(bytes)
}

func main() {
    // Protocol buffers field header: field 1, type 0 (varint)
    fieldHeader := "\x08"  // field 1, wire type 0

    // Encode the number 150 as a varint
    varint150 := buildVarint(150)

    fmt.Printf("Field header: %x\n", fieldHeader)
    fmt.Printf("Varint 150:   %x\n", varint150)

    // Simple binary protocol example
    // Null byte as separator in a custom protocol
    msg := "KEY" + "\x00" + "VALUE" + "\x00"
    parts := strings.Split(msg[:len(msg)-1], "\x00")
    fmt.Println("Key:", parts[0])
    fmt.Println("Val:", parts[1])
}
```

---

## 12. Coding Patterns

### Pattern: Named Escape Constants

```go
// Define named constants for commonly used escape sequences
const (
    CRLF     = "\r\n"  // Windows/HTTP line ending
    LF       = "\n"    // Unix line ending
    Tab      = "\t"    // Tab character
    NullByte = "\x00"  // Null separator
    BOM      = "\ufeff" // UTF-8 Byte Order Mark
)
```

### Pattern: Field Separator Detection

```go
// Detect line ending style in a file
func detectLineEnding(content string) string {
    if strings.Contains(content, "\r\n") {
        return "CRLF"
    }
    if strings.Contains(content, "\r") {
        return "CR"
    }
    return "LF"
}
```

---

## 13. Clean Code

```go
// Unclear: magic byte values
func parsePacket(data string) (cmd byte, payload string) {
    return data[0], data[1:]
}
// Called with: parsePacket("\x01hello")

// Clear: named constants with documentation
const (
    // CmdCreate creates a new resource (0x01)
    CmdCreate byte = 0x01
    // CmdRead reads an existing resource (0x02)
    CmdRead byte = 0x02
    // CmdUpdate updates a resource (0x03)
    CmdUpdate byte = 0x03
    // CmdDelete deletes a resource (0x04)
    CmdDelete byte = 0x04
)

func parsePacket(data string) (cmd byte, payload string) {
    return data[0], data[1:]
}
// Called with: parsePacket(string([]byte{CmdCreate}) + "hello")
```

---

## 14. Debugging Guide

### Using %q to Reveal Hidden Characters

```go
// %q shows escape sequences in the output — invaluable for debugging
s := "hello\nworld\t!"
fmt.Printf("%s\n", s)  // prints literally with newline and tab
fmt.Printf("%q\n", s)  // prints: "hello\nworld\t!" — shows escapes

// For finding invisible characters:
suspect := "hello \u200b world"  // zero-width space
fmt.Printf("%q\n", suspect)      // "hello \u200b world"
fmt.Println(len(suspect))        // 14 (not 11!)

// Check for carriage returns in supposedly Unix strings:
line := "hello\r\n"
fmt.Printf("%q\n", line) // "hello\r\n"
```

### Common Debugging Pattern

```go
// When a string comparison fails unexpectedly:
a := "hello"
b := getUserInput() // might have trailing \r or spaces

if a != b {
    fmt.Printf("a = %q (len=%d)\n", a, len(a))
    fmt.Printf("b = %q (len=%d)\n", b, len(b))
    // Will show something like:
    // a = "hello" (len=5)
    // b = "hello\r" (len=6)  ← there's the problem!
}
```

---

## 15. Comparison with Other Languages

| Feature | Go | C | Python | Java | JavaScript |
|---------|-----|---|--------|------|------------|
| `\n` newline | Yes | Yes | Yes | Yes | Yes |
| `\t` tab | Yes | Yes | Yes | Yes | Yes |
| `\uXXXX` Unicode | Yes | C11 | Yes | Yes | Yes |
| `\UXXXXXXXX` | Yes | No | Yes | No | No (uses `\u{XXXXXX}`) |
| `\xHH` hex | Yes (2 digits exact) | Yes (variable) | Yes | Yes | Yes |
| `\ooo` octal | Yes | Yes | Yes | No | No |
| `\0` null | No (`\x00`) | Yes | Yes | Yes | Yes |
| Raw string | `` `...` `` | No | `r"..."` | — | `` `...` `` |

**Key difference from C**: Go's `\x` always takes exactly 2 hex digits. C's `\x` takes any number, which leads to ambiguous code like `"\x1G"` (is it `\x1` followed by G, or `\x1G`?).

**Key difference from Python**: Python has `\N{name}` escapes for named Unicode characters (e.g., `"\N{SNOWMAN}"`). Go does not.

---

## 16. Error Handling

```go
import "strconv"

// strconv.Unquote processes Go string escapes
// Use it to safely interpret user-provided escape sequences
func interpretEscapes(s string) (string, error) {
    // Wrap in quotes to make it a valid Go string literal
    quoted := `"` + s + `"`
    return strconv.Unquote(quoted)
}

func main() {
    result, err := interpretEscapes(`hello\nworld`)
    if err != nil {
        fmt.Printf("error: %v\n", err)
        return
    }
    fmt.Printf("%q\n", result) // "hello\nworld"

    // Invalid escape:
    _, err = interpretEscapes(`\q is not valid`)
    fmt.Println(err) // invalid syntax
}
```

---

## 17. Security Considerations

### Unicode Homoglyphs in Strings

```go
// Different Unicode characters can look identical
a := "\u0061"  // 'a' — Latin small letter a (U+0061)
b := "\u0430"  // 'а' — Cyrillic small letter a (U+0430)

fmt.Println(a == b)  // false — different Unicode code points
fmt.Println(a)       // a
fmt.Println(b)       // а (looks the same in some fonts!)

// Security risk: domain spoofing — "pаypal.com" with Cyrillic 'а'
// Mitigation: for security-sensitive strings, validate character ranges
import "unicode"

func isASCII(s string) bool {
    for _, r := range s {
        if r > 127 {
            return false
        }
    }
    return true
}
```

### Null Bytes in Security Contexts

```go
// In some systems, null bytes (\x00) can cause path truncation
// "etc/passwd\x00.png" might be treated as "/etc/passwd" by some C functions
// Always validate/sanitize strings that contain user input

func sanitizePath(s string) error {
    if strings.ContainsRune(s, '\x00') {
        return errors.New("path contains null byte")
    }
    return nil
}
```

---

## 18. Performance Tips

- All escape sequences are processed at compile time — zero runtime cost
- `"\n"` in binary is 1 byte, not 2; `"\x41"` is 1 byte, not 4
- The choice between `"A"`, `"\x41"`, `"\u0041"` has NO runtime difference
- Long string literals with many `\xHH` escapes only affect compile time, not runtime

---

## 19. Metrics & Analytics

```go
// Useful for embedded metrics strings with special formatting
const prometheusTextFormat = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} %d
http_requests_total{method="POST",status="201"} %d
`

func exportMetrics(getCount, postCount int) string {
    return fmt.Sprintf(strings.TrimSpace(prometheusTextFormat), getCount, postCount)
}
```

---

## 20. Best Practices

1. **Use `\n` for newlines** in format strings (not literal Enter)
2. **Use `\u` for documenting specific Unicode characters** rather than `\x` byte sequences
3. **Use named constants** for non-obvious escape sequences (`const BOM = "\ufeff"`)
4. **Use `%q` for debugging** strings with potential invisible characters
5. **Prefer direct characters** (`"café"`) over Unicode escapes when source is UTF-8
6. **Use `\r\n` consistently** for HTTP headers and Windows files
7. **Use raw strings** when backslashes appear frequently (3+ in a string)

---

## 21. Edge Cases & Pitfalls

```go
// Pitfall 1: Octal escape requires 3 digits
"\12"   // valid: octal 12 = 10 = '\n' (newline)
"\012"  // also valid and clearer
// BUT: "\8" or "\9" are invalid (digits 8 and 9 don't exist in octal)
// "\400" is invalid (octal 400 = decimal 256, too large for a byte)

// Pitfall 2: \x requires exactly 2 hex digits
"\x4"   // INVALID: compile error (needs 2 digits, got 1)
"\x04"  // valid: byte value 4
"\x41G" // valid: \x41 = 'A', then 'G', so "AG"

// Pitfall 3: \u can only use exactly 4 hex digits
"\u41"   // INVALID: needs 4 digits
"\u0041" // valid: 'A'

// Pitfall 4: \U can only use exactly 8 hex digits
"\U1F600"   // INVALID: needs 8 digits
"\U0001F600" // valid: 😀
```

---

## 22. Common Mistakes

```go
// Mistake 1: Using \0 for null byte (Python habit)
// bad := "\0"  // COMPILE ERROR: unknown escape sequence \0
good := "\x00" // or: "\000" (octal)

// Mistake 2: \x with wrong number of digits
// bad := "\x4"  // COMPILE ERROR
good2 := "\x04" // correct

// Mistake 3: Using \u for emoji (needs \U)
// bad := "\uD83D\uDE00"  // surrogate pair — not valid Unicode in Go!
good3 := "\U0001F600"     // correct: 😀

// Mistake 4: Mixing up \u (4 digits) and \U (8 digits)
// bad := "\U4e2d"   // COMPILE ERROR: \U needs 8 digits
good4 := "\u4e2d"    // correct: 中
good5 := "\U00004e2d" // also correct: 中 (padded to 8 digits)
```

---

## 23. Common Misconceptions

| Misconception | Reality |
|--------------|---------|
| `"\n"` stores 2 bytes | It stores 1 byte (0x0A) |
| `"\x41"` and `"A"` are different | They're identical at runtime |
| `\u` and `\U` produce different encodings | Both produce UTF-8; `\U` just handles higher code points |
| You can use `\0` for null byte | Go uses `\x00` or `\000`, not `\0` |
| Escape sequences are processed at runtime | All processing is at compile time |

---

## 24. Tricky Points

```go
// Tricky 1: \u vs \x for the same character
fmt.Println("\u00e9" == "\xc3\xa9")  // true! (é as code point vs UTF-8 bytes)
// \u00e9 = U+00E9 = encoded as \xc3\xa9 in UTF-8

// Tricky 2: Invalid \u surrogate pairs
// Go does NOT allow lone surrogates in \u escapes
// "\ud800" would produce the replacement character, not a surrogate
// In Go's regexp: \ud800 is explicitly disallowed

// Tricky 3: BOM is a valid string in Go
bom := "\ufeff"
fmt.Println(len(bom)) // 3 (U+FEFF is encoded as ef bb bf in UTF-8)

// Tricky 4: Octal and hex escapes only produce bytes, not Unicode
// "\x80" is a single byte 0x80 — NOT the Unicode character U+0080!
// To get U+0080, use "\u0080" which produces the 2-byte UTF-8 sequence c2 80
fmt.Println(len("\x80"))    // 1 byte (NOT valid UTF-8!)
fmt.Println(len("\u0080"))  // 2 bytes (valid UTF-8)
```

---

## 25. Test

```go
package main

import (
    "testing"
    "unicode/utf8"
)

func TestEscapeEquivalence(t *testing.T) {
    // All these are the same character 'A':
    forms := []string{
        "A",
        "\x41",
        "\101",
        "\u0041",
        "\U00000041",
    }
    for i, s := range forms {
        if s != forms[0] {
            t.Errorf("form %d %q != %q", i, s, forms[0])
        }
    }
}

func TestUnicodeVsHex(t *testing.T) {
    // U+00E9 (é) should equal its UTF-8 byte sequence
    unicode := "\u00e9"
    hex := "\xc3\xa9"
    if unicode != hex {
        t.Errorf("\\u00e9 != \\xc3\\xa9")
    }
    if !utf8.ValidString(unicode) {
        t.Error("unicode escape should produce valid UTF-8")
    }
    if !utf8.ValidString(hex) {
        t.Error("UTF-8 byte sequence should be valid UTF-8")
    }
}

func TestHexNotValidUTF8(t *testing.T) {
    s := "\xff"
    if utf8.ValidString(s) {
        t.Error("\\xff should not be valid UTF-8")
    }
    if len(s) != 1 {
        t.Errorf("\\xff should be 1 byte, got %d", len(s))
    }
}
```

---

## 26. Tricky Questions

**Q: What is the difference between `"\u00e9"` and `"\xc3\xa9"`?**
A: They produce the same string at runtime! U+00E9 (é) is encoded as the bytes 0xC3 0xA9 in UTF-8. `"\u00e9"` uses a Unicode code point escape and the compiler produces the UTF-8 encoding. `"\xc3\xa9"` directly specifies the UTF-8 bytes. The result is identical.

**Q: Is `"\x80"` valid UTF-8?**
A: No. Byte 0x80 as a standalone byte is not valid UTF-8. UTF-8 sequences starting with bytes in the range 0x80-0xBF are continuation bytes and are only valid after a leading byte. Use `unicode/utf8.ValidString("\x80")` → `false`. To get U+0080, use `"\u0080"` which produces 2 bytes: 0xC2 0x80.

**Q: Why doesn't Go support `\0` for null byte like C does?**
A: Go's `\ooo` octal escape requires exactly 3 digits, so `\0` is invalid. Use `\000` or `\x00`. This is a deliberate design choice to avoid the confusion in C where `"\0abc"` is a 4-byte string (null + a + b + c).

**Q: Can you use `\u` to represent all Unicode characters?**
A: No. `\uXXXX` is limited to the Basic Multilingual Plane (U+0000 to U+FFFF). For characters above U+FFFF (like emoji, many rare CJK characters), you need `\UXXXXXXXX` with 8 hex digits.

---

## 27. Cheat Sheet

```go
// All numeric escape forms for the character 'A' (U+0041):
"\x41"       // hex (exactly 2 digits)
"\101"       // octal (exactly 3 digits)
"\u0041"     // Unicode 4-digit
"\U00000041" // Unicode 8-digit
"A"          // direct (preferred)

// Common CRLF patterns
"\r\n"       // Windows/HTTP line ending
"\n"         // Unix line ending

// Binary data
"\x00"       // null byte
"\xff"       // max byte value (not valid UTF-8 standalone)
"\x01\x02"   // two raw bytes

// Unicode categories
"\u0041"     // ASCII range (1 byte in UTF-8)
"\u00e9"     // Latin extended (2 bytes in UTF-8: é)
"\u4e2d"     // CJK (3 bytes in UTF-8: 中)
"\U0001F600" // Supplementary (4 bytes in UTF-8: 😀)

// Debug strings
fmt.Printf("%q\n", s)  // show escape sequences
fmt.Printf("%x\n", s)  // show hex bytes
```

---

## 28. Self-Assessment Checklist

- [ ] I know all numeric escape forms: `\x`, `\u`, `\U`, `\ooo`
- [ ] I understand the difference between `\u` (4 digits) and `\U` (8 digits)
- [ ] I know that `\u00e9` and `\xc3\xa9` produce the same string
- [ ] I understand why `\x80` is not valid UTF-8 but `\u0080` is
- [ ] I can use `%q` to debug strings with hidden characters
- [ ] I know when to use raw strings vs interpreted strings
- [ ] I understand that escape processing is compile-time only
- [ ] I can explain why `\n` is 1 byte, not 2

---

## 29. Summary

Interpreted string literals process escape sequences at compile time:
- `\n`, `\t`, `\\`, `\"` for common characters
- `\xHH` for exact byte values (2 hex digits, always)
- `\uXXXX` for Unicode BMP characters (4 hex digits)
- `\UXXXXXXXX` for all Unicode characters (8 hex digits)
- All produce valid UTF-8 except `\x` (which can produce arbitrary bytes)

---

## 30. Further Reading

- [Go Spec: Rune literals (related escapes)](https://go.dev/ref/spec#Rune_literals)
- [Go Spec: String literals](https://go.dev/ref/spec#String_literals)
- [strconv.Unquote documentation](https://pkg.go.dev/strconv#Unquote)
- [Unicode table for common escapes](https://unicode-table.com/)
- [ANSI escape codes reference](https://en.wikipedia.org/wiki/ANSI_escape_code)

---

## 31. Related Topics

- Raw string literals — backtick strings without escape processing
- `unicode/utf8` — validate and decode UTF-8 strings
- `strconv.Unquote` — interpret Go string escapes programmatically
- `fmt.Sprintf` with `%q` verb — quote a string with Go escape syntax
- Binary protocols — where `\xHH` escapes shine

---

## 32. Diagrams & Visual Aids

### Numeric Escape Sizes

```
Escape Type   Digits  Range        UTF-8 Output
─────────────────────────────────────────────────
\xHH          2 hex   0x00-0xFF   1 byte (may not be valid UTF-8)
\ooo          3 oct   0-377       1 byte (may not be valid UTF-8)
\uXXXX        4 hex   U+0000-FFFF 1-3 bytes (always valid UTF-8)
\UXXXXXXXX    8 hex   U+0-10FFFF  1-4 bytes (always valid UTF-8)
```

### Unicode to UTF-8 Encoding

```
Code Point Range     UTF-8 Encoding Pattern
U+0000 - U+007F      0xxxxxxx                 (1 byte)
U+0080 - U+07FF      110xxxxx 10xxxxxx        (2 bytes)
U+0800 - U+FFFF      1110xxxx 10xxxxxx 10xxxxxx  (3 bytes)
U+10000 - U+10FFFF   11110xxx 10xxxxxx 10xxxxxx 10xxxxxx (4 bytes)

Examples:
\u0041 → 'A'  → 0x41           (1 byte)
\u00e9 → 'é'  → 0xC3 0xA9     (2 bytes)
\u4e2d → '中' → 0xE4 0xB8 0xAD (3 bytes)
\U0001F600 → '😀' → 0xF0 0x9F 0x98 0x80 (4 bytes)
```
