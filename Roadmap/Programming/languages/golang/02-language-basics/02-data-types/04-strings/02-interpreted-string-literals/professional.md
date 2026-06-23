# Interpreted String Literals in Go — Professional Level (Internals)

## 1. Introduction

This document examines the compiler implementation of interpreted string literals: how the lexer processes escape sequences, what `strconv.Unquote` does under the hood, how the constant evaluator produces the final byte sequence, and what the runtime does with it.

---

## 2. Lexer Processing of Interpreted Strings

The Go lexer (in `src/go/scanner/scanner.go`) processes interpreted strings in the `scanString` function:

```go
// Simplified version of interpreted string scanning
func (s *Scanner) scanString() {
    // We've already consumed the opening double-quote
    for {
        ch := s.next()
        if ch == '"' {
            break  // end of string
        }
        if ch == '\n' || ch == eof {
            s.error(s.file.Offset(s.pos), "string literal not terminated")
            break
        }
        if ch == '\\' {
            // Scan the escape sequence
            s.scanEscape('"')
        }
        // Otherwise, store ch as-is
    }
}
```

The lexer stores the raw source text (with escape sequences as-is). The actual interpretation happens during constant evaluation.

---

## 3. strconv.Unquote — The Core Engine

The `strconv.Unquote` function performs the actual escape sequence processing:

```go
// src/strconv/quote.go (key section)
func UnquoteChar(s string, quote byte) (value rune, multibyte bool, tail string, err error) {
    if s[0] != '\\' {
        // Not an escape sequence
        r, size := utf8.DecodeRuneInString(s)
        return r, size > 1, s[size:], nil
    }
    // s[0] == '\\'
    switch s[1] {
    case 'a':  return '\a', false, s[2:], nil
    case 'b':  return '\b', false, s[2:], nil
    case 'f':  return '\f', false, s[2:], nil
    case 'n':  return '\n', false, s[2:], nil
    case 'r':  return '\r', false, s[2:], nil
    case 't':  return '\t', false, s[2:], nil
    case 'v':  return '\v', false, s[2:], nil
    case '\\': return '\\', false, s[2:], nil
    case '\'', '"':
        if s[1] != quote {
            err = ErrSyntax // cannot use \' in a string literal
            return
        }
        return rune(s[1]), false, s[2:], nil
    case '0', '1', '2', '3', '4', '5', '6', '7':
        // Octal: \ooo (3 digits, value 0-255)
        v, _ := strconv.ParseUint(s[1:4], 8, 8)
        return rune(v), false, s[4:], nil
    case 'x':
        // Hex: \xHH (exactly 2 digits)
        v, _ := strconv.ParseUint(s[2:4], 16, 8)
        return rune(v), false, s[4:], nil
    case 'u':
        // Unicode 4-digit: \uXXXX
        r, _ := strconv.ParseUint(s[2:6], 16, 16)
        return rune(r), r > 0x7f, s[6:], nil
    case 'U':
        // Unicode 8-digit: \UXXXXXXXX
        r, _ := strconv.ParseUint(s[2:10], 16, 32)
        return rune(r), r > 0x7f, s[10:], nil
    }
    return 0, false, "", ErrSyntax
}
```

---

## 4. How \u and \U Produce UTF-8

When `\uXXXX` is processed, the rune value is encoded as UTF-8:

```go
// After parsing the code point, it's encoded to UTF-8 using utf8.AppendRune
// src/strconv/quote.go:
buf = utf8.AppendRune(buf, r)

// utf8.AppendRune (src/unicode/utf8/utf8.go):
func AppendRune(p []byte, r rune) []byte {
    // Determine encoding width
    switch {
    case uint32(r) <= rune1Max:
        return append(p, byte(r))
    case uint32(r) <= rune2Max:
        return append(p, t2|byte(r>>6), tx|byte(r)&maskx)
    case uint32(r) > MaxRune, surrogateMin <= r && r <= surrogateMax:
        r = RuneError  // invalid: use replacement character
        fallthrough
    case uint32(r) <= rune3Max:
        return append(p, t3|byte(r>>12), tx|byte(r>>6)&maskx, tx|byte(r)&maskx)
    default:
        return append(p, t4|byte(r>>18), tx|byte(r>>12)&maskx,
            tx|byte(r>>6)&maskx, tx|byte(r)&maskx)
    }
}
```

This is why `"\u4e2d"` and the UTF-8 bytes `"\xe4\xb8\xad"` are identical at runtime — the compiler converts the Unicode code point to its UTF-8 byte sequence at compile time.

---

## 5. \x vs \u: Critical Difference at the Byte Level

```
\x41:
  Input:  \x41
  Parse:  byte value 0x41
  Output: [0x41]  (1 byte)
  UTF-8 valid? Yes (ASCII range)

\u0041:
  Input:  \u0041
  Parse:  rune value 0x0041 ('A')
  UTF-8 encode: [0x41] (1 byte — same as \x41 for ASCII)
  Output: [0x41]

\x80:
  Input:  \x80
  Parse:  byte value 0x80
  Output: [0x80]  (1 byte)
  UTF-8 valid? NO — 0x80 is a continuation byte, invalid alone

\u0080:
  Input:  \u0080
  Parse:  rune value 0x0080
  UTF-8 encode: [0xC2, 0x80] (2 bytes — Latin Extended, U+0080)
  Output: [0xC2, 0x80]
  UTF-8 valid? YES

Key insight: \x embeds raw bytes (may not be valid UTF-8)
             \u and \U embed Unicode code points (always valid UTF-8)
```

---

## 6. Compiler Constant Evaluation Pipeline

```
1. Source text:   "Hello\nWorld\u4e2d"
                       ↓
2. Lexer:         token.STRING, Value = "\"Hello\\nWorld\\u4e2d\""
                  (stores raw source, including quotes and backslashes)
                       ↓
3. Parser:        ast.BasicLit{Kind: STRING, Value: "\"Hello\\nWorld\\u4e2d\""}
                       ↓
4. Type checker / constant evaluator:
   calls strconv.Unquote("\"Hello\\nWorld\\u4e2d\"")
   processes:
     H → 0x48
     e → 0x65
     l → 0x6c
     l → 0x6c
     o → 0x6f
     \n → 0x0a (newline)
     W → 0x57
     o → 0x6f
     r → 0x72
     l → 0x6c
     d → 0x64
     \u4e2d → 0xe4 0xb8 0xad (UTF-8 encoding of U+4E2D)
                       ↓
5. Code generation: 14 bytes stored in .rodata section
                    [48 65 6c 6c 6f 0a 57 6f 72 6c 64 e4 b8 ad]
```

---

## 7. Invalid Escape Handling

The Go compiler rejects invalid escape sequences at compile time:

```go
// These are all compile errors:
"\q"        // unknown escape sequence
"\x4"       // \x needs exactly 2 hex digits
"\u41"      // \u needs exactly 4 hex digits
"\U1F600"   // \U needs exactly 8 hex digits
"\ud800"    // surrogate code point — invalid in Go
"\U00110000" // beyond valid Unicode range (max is U+10FFFF)

// Specifically, these checks exist in strconv.UnquoteChar:
// - \x must be followed by exactly 2 hex digits
// - \u must be followed by exactly 4 hex digits
// - \U must be followed by exactly 8 hex digits
// - \U and \u values must be <= MaxRune (U+10FFFF)
// - Surrogates (U+D800–U+DFFF) are rejected
```

---

## 8. Surrogate Pair Handling

Go explicitly disallows lone surrogate code points in string literals:

```go
// UTF-16 uses surrogates (U+D800-U+DFFF) for characters above U+FFFF
// UTF-8 does NOT use surrogates — they're illegal in UTF-8

// Go correctly rejects:
// "\ud800"  // compile error: invalid Unicode code point

// If you receive UTF-16 data with surrogates, decode with encoding/utf16:
import "unicode/utf16"

utf16Data := []uint16{0xD83D, 0xDE00} // 😀 as UTF-16 surrogate pair
runes := utf16.Decode(utf16Data)       // [128512] = 0x1F600 = '😀'
s := string(runes)                     // "😀" as valid UTF-8
```

---

## 9. Binary Output for Each Escape Type

```
Escape        Source bytes   Output bytes
────────────────────────────────────────────────
\a            \a             07
\b            \b             08
\f            \f             0c
\n            \n             0a
\r            \r             0d
\t            \t             09
\v            \v             0b
\\            \\             5c
\"            \"             22
\'            \'             27
\101 (oct)    \101           41  (= 'A')
\x41 (hex)    \x41           41  (= 'A')
\u0041        \u0041         41  (= 'A', UTF-8 for U+0041)
\u4e2d        \u4e2d         e4 b8 ad  (3 bytes, UTF-8 for U+4E2D = 中)
\U0001F600    \U0001F600     f0 9f 98 80  (4 bytes, UTF-8 for U+1F600 = 😀)
```

---

## 10. Examining Compiler Output

```bash
# Compile and disassemble to see string storage:
cat > main.go << 'EOF'
package main
import "fmt"
func main() {
    s := "Hello\n\u4e2d\U0001F600"
    fmt.Println(len(s))
}
EOF

go build -o prog main.go

# Show string data in binary:
strings -t x prog | head -20

# Show .rodata section:
go tool objdump -s "main\." prog | head -30

# Show assembly:
go tool compile -S main.go | grep -A5 '"string"'
```

---

## 11. The strconv Package and String Quoting

```go
// strconv.Quote produces the Go source representation of a string
// (the inverse of Unquote)
s := "Hello\n中文\U0001F600"
fmt.Println(strconv.Quote(s))
// "Hello\n中文😀"
// Note: printable non-ASCII chars are kept as-is
// Non-printable chars get \x, \u, or \U escapes

// strconv.QuoteToASCII ensures all non-ASCII is escaped
fmt.Println(strconv.QuoteToASCII(s))
// "Hello\n\u4e2d\u6587\U0001f600"
// All non-ASCII chars are escaped

// strconv.AppendQuote is the allocation-friendly version
var buf []byte
buf = strconv.AppendQuote(buf, s)
```

---

## 12. Further Reading

- `src/strconv/quote.go` — `Unquote`, `UnquoteChar` implementation
- `src/go/scanner/scanner.go` — Lexer implementation
- `src/unicode/utf8/utf8.go` — UTF-8 encoding/decoding
- [Go Spec: String literals](https://go.dev/ref/spec#String_literals)
- [Unicode FAQ on UTF-8](https://www.unicode.org/faq/utf_bom.html)
- [RFC 3629: UTF-8](https://tools.ietf.org/html/rfc3629)

---

## Summary

The interpreted string literal pipeline:
1. **Lexer**: scans characters between `"..."`, stores raw source text as token value
2. **Constant evaluator**: calls `strconv.Unquote` which processes escape sequences
3. **\x**: raw byte insertion (may not be valid UTF-8)
4. **\u/\U**: Unicode code point → UTF-8 encoding (always valid UTF-8)
5. **Code generation**: final bytes stored in `.rodata`

The key insight: `\u` and `\U` go through `utf8.AppendRune`, ensuring valid UTF-8. `\x` directly inserts bytes, which can produce invalid UTF-8. This is the fundamental difference at the machine level.
