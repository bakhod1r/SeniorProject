# Interpreted String Literals in Go — Tasks

## Task 1: Escape Sequence Explorer

Build a program that takes a string and shows the details of each byte, including which escape sequence would represent it.

**Requirements:**
- For each byte, show: index, hex value, decimal value, and printable representation
- Identify special characters (newline, tab, etc.) with their escape name
- Handle both ASCII and multi-byte UTF-8 characters
- Show total byte count and rune count

**Starter Code:**
```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func analyzeString(s string) {
    fmt.Printf("String: %q\n", s)
    fmt.Printf("Bytes: %d, Runes: %d\n\n", len(s), utf8.RuneCountInString(s))
    fmt.Printf("%-6s %-8s %-6s %-10s %s\n", "Index", "Hex", "Dec", "Char", "Escape")
    fmt.Println("─────────────────────────────────────────")

    // TODO: iterate byte by byte and print information
    // For special characters like \n, \t, \r, show their escape name
    // Use a map[byte]string for known escapes
    escapes := map[byte]string{
        '\n': "\\n",
        '\t': "\\t",
        '\r': "\\r",
        // TODO: add more
    }
    _ = escapes
}

func main() {
    analyzeString("Hello\nWorld\t!")
    fmt.Println()
    analyzeString("café")
    fmt.Println()
    analyzeString("\x00\x01\x02ABC")
}
```

---

## Task 2: Line Ending Normalizer

Build a cross-platform text normalizer that handles all common line ending formats.

**Requirements:**
- Detect the line ending style (LF, CRLF, CR) of a string
- Convert between line ending styles
- Count lines correctly regardless of style
- Handle files with mixed line endings
- Preserve trailing newline if present

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

type LineEnding string

const (
    LF   LineEnding = "\n"
    CRLF LineEnding = "\r\n"
    CR   LineEnding = "\r"
)

// DetectLineEnding returns the predominant line ending style
func DetectLineEnding(s string) LineEnding {
    // TODO: count occurrences of each type, return the most common
    _ = strings.Count // hint
    return LF
}

// Normalize converts all line endings to the target style
func Normalize(s string, target LineEnding) string {
    // TODO: convert from any line ending to target
    // Important: first normalize all to LF, then convert
    return s
}

// CountLines returns the number of lines (not counting the final empty line after trailing newline)
func CountLines(s string) int {
    // TODO: count lines correctly
    return 0
}

func main() {
    tests := []struct {
        name  string
        input string
    }{
        {"Unix LF", "line1\nline2\nline3\n"},
        {"Windows CRLF", "line1\r\nline2\r\nline3\r\n"},
        {"Old Mac CR", "line1\rline2\rline3\r"},
        {"Mixed", "line1\nline2\r\nline3\r"},
    }

    for _, tt := range tests {
        fmt.Printf("=== %s ===\n", tt.name)
        fmt.Printf("Detected: %q\n", DetectLineEnding(tt.input))
        fmt.Printf("Lines: %d\n", CountLines(tt.input))
        normalized := Normalize(tt.input, CRLF)
        fmt.Printf("As CRLF: %q\n\n", normalized)
    }
}
```

---

## Task 3: ANSI Color Terminal Library

Build a terminal color library using ANSI escape sequences.

**Requirements:**
- Support foreground and background colors: black, red, green, yellow, blue, magenta, cyan, white
- Support text styles: bold, dim, italic, underline, blink, reverse, strikethrough
- `Colorize(text string, codes ...int) string` function
- Auto-disable when output is not a terminal
- Named helper functions: `Red(s)`, `Green(s)`, `Bold(s)`, etc.

**Starter Code:**
```go
package ansi

import (
    "fmt"
    "os"
)

// ANSI escape codes
const (
    escape = "\x1b["  // TODO: this is the ESC character followed by [
    reset  = "\x1b[0m"

    // Foreground colors
    FgBlack   = 30
    FgRed     = 31
    FgGreen   = 32
    FgYellow  = 33
    FgBlue    = 34
    FgMagenta = 35
    FgCyan    = 36
    FgWhite   = 37

    // TODO: Add background colors (40-47) and styles (1=bold, 2=dim, etc.)
)

// IsTerminal checks if the given file descriptor is a terminal
func IsTerminal(fd uintptr) bool {
    // Simple check — production code would use golang.org/x/term
    return fd < 3 // stdin=0, stdout=1, stderr=2
}

var enabled = IsTerminal(os.Stdout.Fd())

// Colorize wraps text with ANSI escape codes
func Colorize(text string, codes ...int) string {
    if !enabled {
        return text
    }
    // TODO: build escape sequence and wrap text
    _ = fmt.Sprintf // hint
    return text
}

// Red returns text in red
func Red(s string) string { return Colorize(s, FgRed) }
// TODO: implement other color functions

func main() {
    // Example usage
    fmt.Println(Red("Error: something went wrong"))
    fmt.Println(Colorize("Success!", FgGreen, 1)) // bold green
}
```

---

## Task 4: Go String Literal Parser

Build a parser that reads Go string literals (both interpreted and raw) and returns the actual string value.

**Requirements:**
- Parse interpreted strings: `"hello\nworld"` → `hello` + newline + `world`
- Parse raw strings: `` `hello\nworld` `` → `hello\nworld` (literal)
- Support all Go escape sequences
- Return an error for invalid escape sequences
- Handle both forms transparently

**Starter Code:**
```go
package litparse

import (
    "fmt"
    "strconv"
)

// ParseStringLiteral parses a Go string literal (with quotes/backticks)
// and returns the string value
func ParseStringLiteral(s string) (string, error) {
    if len(s) < 2 {
        return "", fmt.Errorf("string too short")
    }

    // TODO: determine if it's a raw string (backtick) or interpreted (double quote)
    // For interpreted: use strconv.Unquote
    // For raw: strip backticks and remove \r
    _ = strconv.Unquote // hint
    return "", fmt.Errorf("not implemented")
}

func main() {
    tests := []string{
        `"hello\nworld"`,
        `"Hello\u4e2d\u6587"`,
        `"tab\there"`,
        "\"embedded \\\"quotes\\\"\"",
        "`raw \\n string`",
        "`multi\nline`",
    }

    for _, lit := range tests {
        result, err := ParseStringLiteral(lit)
        if err != nil {
            fmt.Printf("Error parsing %s: %v\n", lit, err)
            continue
        }
        fmt.Printf("Input:  %s\n", lit)
        fmt.Printf("Output: %q\n\n", result)
    }
}
```

---

## Task 5: Binary Protocol Encoder/Decoder

Build a simple binary protocol using escape sequences to define the wire format.

**Requirements:**
- Messages are framed with `\x02` (STX) at start and `\x03` (ETX) at end
- Message type is encoded as a single byte
- Payload is UTF-8 text
- Length is encoded as a 4-byte big-endian integer
- Implement `Encode(msgType byte, payload string) []byte`
- Implement `Decode(data []byte) (msgType byte, payload string, err error)`

**Starter Code:**
```go
package protocol

import (
    "encoding/binary"
    "fmt"
)

// Frame delimiters using escape sequences
const (
    STX = "\x02" // Start of Text
    ETX = "\x03" // End of Text
)

// Message types
const (
    TypeHello   byte = 0x01
    TypeGoodbye byte = 0x02
    TypeData    byte = 0x03
    TypeError   byte = 0xFF
)

// Encode creates a framed message
// Format: STX(1) + type(1) + length(4) + payload(n) + ETX(1)
func Encode(msgType byte, payload string) []byte {
    // TODO: build the frame
    // Hint: use encoding/binary.BigEndian.PutUint32 for length
    _ = binary.BigEndian
    return nil
}

// Decode parses a framed message
func Decode(data []byte) (msgType byte, payload string, err error) {
    // TODO: validate frame and extract fields
    // Check for STX at start, ETX at end
    // Extract type and length
    // Validate payload length matches encoded length
    return 0, "", fmt.Errorf("not implemented")
}

func main() {
    // Encode a hello message
    encoded := Encode(TypeHello, "Hello, World!")
    fmt.Printf("Encoded: %x\n", encoded)

    // Decode it back
    msgType, payload, err := Decode(encoded)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Printf("Type: 0x%02x, Payload: %q\n", msgType, payload)
}
```

---

## Task 6: Unicode Character Analyzer

Build a tool that analyzes Unicode characters in a string and reports their properties.

**Requirements:**
- For each rune, show: code point, UTF-8 bytes, Unicode category, name (if available)
- Identify characters that might be security concerns (homoglyphs, invisible chars)
- Report if string is pure ASCII
- Report if string is NFC normalized

**Starter Code:**
```go
package main

import (
    "fmt"
    "unicode"
    "unicode/utf8"
)

type CharInfo struct {
    Index    int
    Rune     rune
    UTF8     []byte
    Category string
    IsASCII  bool
    IsVisible bool
}

func analyzeCharacter(r rune) CharInfo {
    // TODO: categorize the rune
    // Hints:
    // unicode.IsLetter(r), unicode.IsDigit(r), unicode.IsPunct(r)
    // unicode.IsControl(r), unicode.IsPrint(r)
    _ = unicode.IsLetter
    return CharInfo{Rune: r}
}

func analyzeString(s string) []CharInfo {
    var results []CharInfo
    for i, r := range s {
        info := analyzeCharacter(r)
        info.Index = i
        // TODO: extract UTF-8 bytes for this rune
        _, size := utf8.DecodeRuneInString(s[i:])
        info.UTF8 = []byte(s[i : i+size])
        results = append(results, info)
    }
    return results
}

func main() {
    test := "Hello\u200bWorld" // contains zero-width space
    infos := analyzeString(test)
    for _, info := range infos {
        fmt.Printf("U+%04X %-15s bytes:%-12x visible:%v ascii:%v\n",
            info.Rune, fmt.Sprintf("%q", info.Rune),
            info.UTF8, info.IsVisible, info.IsASCII)
    }
}
```

---

## Task 7: String Escape Sequence Generator

Build a program that takes a Go string and generates the interpreted string literal representation of it (the inverse of escape processing).

**Requirements:**
- Non-printable ASCII chars → `\xHH` escapes
- Non-ASCII Unicode chars → `\u` or `\U` escapes (if not printable)
- Common escapes → use named escapes (`\n`, `\t`, etc.)
- Printable ASCII and common printable Unicode → leave as-is
- Output must be a valid Go string literal

**Starter Code:**
```go
package main

import (
    "fmt"
    "strconv"
    "unicode"
)

// QuoteRune returns the shortest Go escape representation for a rune
func QuoteRune(r rune) string {
    // TODO: use strconv.QuoteRune as inspiration
    // But customize: keep printable ASCII as-is,
    // use \n \t \r etc. for common escapes,
    // use \xHH for non-printable ASCII (0-31, 127-255),
    // use \uXXXX for non-printable non-ASCII
    _ = unicode.IsPrint // hint
    return strconv.QuoteRune(r) // placeholder
}

// ToGoLiteral converts a string to a valid Go interpreted string literal
func ToGoLiteral(s string) string {
    // TODO: wrap in double quotes, escape each character as needed
    // Must produce output that, when parsed by Go, gives back s
    return strconv.Quote(s) // placeholder — customize the escaping rules
}

func main() {
    tests := []string{
        "Hello, World!",
        "line1\nline2\ttabbed",
        "中文 Characters",
        "\x00\x01\x02\x03",
        "café au lait",
    }
    for _, s := range tests {
        literal := ToGoLiteral(s)
        fmt.Printf("Input:   %q\n", s)
        fmt.Printf("Literal: %s\n\n", literal)
    }
}
```

---

## Task 8: HTTP/1.1 Request Parser

Build an HTTP/1.1 request parser that correctly handles CRLF line endings.

**Requirements:**
- Parse request line: method, path, version
- Parse headers (case-insensitive names, `\r\n` terminated lines)
- Parse body (after `\r\n\r\n` separator)
- Handle requests with `\n`-only line endings (lenient mode)
- Return a structured `Request` object

**Starter Code:**
```go
package httpparse

import (
    "fmt"
    "strings"
)

type Request struct {
    Method  string
    Path    string
    Version string
    Headers map[string]string
    Body    string
}

// Parse parses an HTTP/1.1 request
// The CRLF (\r\n) separator is defined using interpreted string literals
func Parse(raw string) (*Request, error) {
    const (
        CRLF       = "\r\n"
        HeaderEnd  = "\r\n\r\n"
        LFonly     = "\n"
    )

    // TODO: parse the request
    // 1. Split on HeaderEnd (CRLF+CRLF) to separate headers from body
    // 2. Parse the request line (first line): METHOD PATH VERSION
    // 3. Parse remaining header lines: "Name: Value"
    // 4. Extract body

    _ = strings.SplitN // hint
    return nil, fmt.Errorf("not implemented")
}

func main() {
    rawRequest := "GET /api/users HTTP/1.1\r\n" +
        "Host: example.com\r\n" +
        "Content-Type: application/json\r\n" +
        "Authorization: Bearer token123\r\n" +
        "\r\n" +
        `{"filter": "active"}`

    req, err := Parse(rawRequest)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Printf("Method: %s\n", req.Method)
    fmt.Printf("Path: %s\n", req.Path)
    fmt.Printf("Host: %s\n", req.Headers["host"])
    fmt.Printf("Body: %s\n", req.Body)
}
```

---

## Task 9: Control Character Sanitizer

Build a robust input sanitizer that handles all types of problematic characters.

**Requirements:**
- Remove or replace control characters (0x00-0x1F, 0x7F)
- Handle ANSI escape sequences
- Preserve legitimate whitespace (`\n`, `\t`)
- Handle null bytes
- Report what was removed/replaced
- Support different sanitization modes: remove, replace with space, replace with `?`

**Starter Code:**
```go
package sanitize

import (
    "fmt"
    "regexp"
    "strings"
    "unicode"
)

type Mode int

const (
    ModeRemove  Mode = iota // Remove problematic chars
    ModeSpace               // Replace with space
    ModeQuestion            // Replace with ?
)

// ANSI escape sequence pattern
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

type SanitizeResult struct {
    Original  string
    Sanitized string
    Removed   []string // descriptions of what was removed
}

func Sanitize(input string, mode Mode) SanitizeResult {
    // TODO: implement sanitization
    // 1. Strip ANSI escape codes first
    // 2. For each rune:
    //    - Keep if printable (unicode.IsPrint) or allowed whitespace (\n, \t)
    //    - Handle null bytes (\x00) as security concern
    //    - Record what was removed

    _ = unicode.IsControl // hint
    _ = strings.ContainsRune
    result := SanitizeResult{Original: input}

    return result
}

func main() {
    inputs := []string{
        "Hello\x00World",               // null byte
        "normal text",                   // clean
        "has\x1b[31mANSI\x1b[0mcodes", // ANSI codes
        "tab\there\nnewline",           // legitimate whitespace
        "\x01\x02\x03control",          // control chars
    }

    for _, s := range inputs {
        result := Sanitize(s, ModeRemove)
        fmt.Printf("Input:     %q\n", result.Original)
        fmt.Printf("Sanitized: %q\n", result.Sanitized)
        if len(result.Removed) > 0 {
            fmt.Printf("Removed:   %v\n", result.Removed)
        }
        fmt.Println()
    }
}
```

---

## Task 10: Unicode Normalization Comparison

Implement a Unicode-aware string comparison that handles different normalization forms.

**Requirements:**
- Demonstrate that visually identical strings can be unequal in Go
- Implement NFC normalization using `golang.org/x/text/unicode/norm`
- Create a `UnicodeSafeEqual(a, b string) bool` function
- Show the byte differences between NFC and NFD forms
- Test with common cases: accented letters, Korean jamo, CJK characters

**Starter Code:**
```go
package main

import (
    "fmt"
    "unicode/utf8"
    // TODO: import golang.org/x/text/unicode/norm
)

// UnicodeSafeEqual compares strings after NFC normalization
func UnicodeSafeEqual(a, b string) bool {
    // TODO: normalize both to NFC then compare
    // For now, just direct comparison
    return a == b
}

// ShowDifference shows why two strings differ
func ShowDifference(a, b string) {
    fmt.Printf("a = %q (len=%d, runes=%d)\n",
        a, len(a), utf8.RuneCountInString(a))
    fmt.Printf("b = %q (len=%d, runes=%d)\n",
        b, len(b), utf8.RuneCountInString(b))
    fmt.Printf("a == b: %v\n", a == b)
    fmt.Printf("SafeEqual: %v\n\n", UnicodeSafeEqual(a, b))
}

func main() {
    // Case 1: é as single code point vs decomposed
    e1 := "\u00e9"         // é as U+00E9 (precomposed NFC)
    e2 := "e\u0301"        // e + combining accent (NFD)
    fmt.Println("=== Accented character ===")
    ShowDifference(e1, e2)

    // Case 2: Korean text
    // 각 can be precomposed or decomposed into jamo
    k1 := "\uac01"         // 각 precomposed
    k2 := "\u1100\u1161\u11a8" // 각 as separate jamo
    fmt.Println("=== Korean ===")
    ShowDifference(k1, k2)

    // Case 3: Regular ASCII (should be equal)
    fmt.Println("=== ASCII ===")
    ShowDifference("hello", "hello")
}
```

---

## Task 11: CSV Writer with Proper Escape Handling

Implement a CSV writer that correctly handles all special characters using escape sequences.

**Requirements:**
- Fields containing `,`, `"`, `\n`, or `\r` must be quoted
- Double `"` inside quoted fields: `""` for one literal quote
- Support different line endings: `\n`, `\r\n`, or `\r`
- Handle null values
- Write to a `strings.Builder`

**Starter Code:**
```go
package csv

import (
    "fmt"
    "strings"
)

type Writer struct {
    lineEnding string   // \n, \r\n, or \r
    b          strings.Builder
}

// NewWriter creates a CSV writer with the given line ending
// Use "\n" for Unix, "\r\n" for Windows/RFC 4180 standard
func NewWriter(lineEnding string) *Writer {
    if lineEnding == "" {
        lineEnding = "\r\n"  // RFC 4180 default
    }
    return &Writer{lineEnding: lineEnding}
}

// WriteRow writes a single CSV row
func (w *Writer) WriteRow(fields []string) {
    // TODO: implement
    // For each field:
    // - Check if it contains ",", "\"", "\n", "\r"
    // - If so, wrap in double quotes and escape internal double quotes
    // Separate fields with commas
    // End row with the configured line ending
    _ = strings.ContainsAny // hint
    _ = fmt.Sprintf         // hint
}

// String returns the accumulated CSV content
func (w *Writer) String() string { return w.b.String() }

func main() {
    w := NewWriter("\r\n")
    w.WriteRow([]string{"Name", "Age", "Bio"})
    w.WriteRow([]string{"Alice", "30", "Lives in NYC"})
    w.WriteRow([]string{"Bob", "25", `He said "hello!"`})
    w.WriteRow([]string{"Carol", "35", "Line 1\nLine 2"})
    fmt.Printf("%q\n", w.String())
}
```
