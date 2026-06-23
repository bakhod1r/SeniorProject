# Raw String Literals in Go — Professional Level (Internals)

## 1. Introduction

This document covers the compiler implementation of raw string literals: how the lexer processes them, how they end up in the binary, and what the Go specification requires. This is for engineers who need to understand the full compilation pipeline for string literals.

---

## 2. The Lexer: Scanning Raw String Literals

The Go lexer (in `src/go/scanner/scanner.go`) handles raw string literals in the `scanString` method:

```go
// Simplified version of raw string scanning
func (s *Scanner) scanRawString() {
    // We've already consumed the opening backtick
    for {
        ch := s.next()
        if ch == '`' {
            break  // end of raw string
        }
        if ch == '\r' {
            continue  // skip carriage returns (Go spec requirement)
        }
        if ch == eof {
            s.error(s.file.Offset(s.pos), "raw string literal not terminated")
            break
        }
        // ch is stored as-is — no interpretation
    }
}
```

The key points:
1. Only the opening and closing backtick are consumed as delimiters
2. `\r` (0x0D) is discarded — this is the only transformation
3. All other bytes are stored as-is
4. EOF before closing backtick is a compile error

---

## 3. The Parser: AST Representation

Raw string literals and interpreted string literals both produce `ast.BasicLit` nodes in the AST with `token.STRING` kind:

```go
// src/go/ast/ast.go
type BasicLit struct {
    ValuePos token.Pos   // literal position
    Kind     token.Token // token.INT, token.FLOAT, token.IMAG, token.CHAR, or token.STRING
    Value    string      // literal string; e.g. 42, 0x7f, 3.14, 1e-9, 2.4i, 'a', '\x7f', "foo" or `\n\n`
}
```

The `Value` field contains the **raw source text** including the delimiter characters:
- For `` `hello` ``: `Value = "\x60hello\x60"` (with backtick characters)
- For `"hello"`: `Value = "\"hello\""` (with quote characters)

The distinction between raw and interpreted is encoded in the delimiter characters of `Value`.

---

## 4. Constant Evaluation

The `go/constant` package evaluates string literals:

```go
// src/go/constant/value.go
// StringVal returns the Go string value of x, which must be of Kind String.

// For a raw string literal `\n`:
// The lexer has already stripped the backticks and the \r chars
// The constant value is the 2-byte string: backslash, n
// This is NOT a newline — it's the two characters

// For an interpreted string literal "\n":
// The constant evaluator processes escape sequences
// The constant value is the 1-byte string: linefeed (0x0a)
```

### Source Code → Binary Constants

```
Source:          `Hello\nWorld`
After lexer:     Hello\nWorld         (12 bytes, \r removed if any)
After parser:    ast.BasicLit{Value: "`Hello\\nWorld`"}
After eval:      constant.Value{"Hello\\nWorld"}
In binary:       .rodata: 48 65 6c 6c 6f 5c 6e 57 6f 72 6c 64
```

---

## 5. Code Generation: String Storage

### String Data in Sections

```bash
# Compile and inspect sections:
go tool compile -S example.go | grep -A3 '"string"'

# Or:
go build -o example example.go
go tool objdump -s "main\." example | head -50

# To find where raw strings live:
strings -t x example | grep "SELECT"
readelf -x .rodata example 2>/dev/null | head -40
```

### Symbol Table Entries

```
For a package-level raw string constant:
  Symbol: main.myQuery (in .rodata)
  Size: len of string bytes
  Type: read-only, not exported if lowercase

For a local raw string (in a function):
  The data goes to .rodata
  The StringHeader (ptr, len) may be on stack or in .text (if constant folded)
```

---

## 6. Memory Model for Raw String Constants

```
Binary sections:
┌────────────────────────────────────────┐
│  .text   │  main() {                   │
│           │    LEAQ  main.query+0, AX  │ ← ptr to .rodata
│           │    MOVQ  AX, 0(SP)         │ ← store in string header
│           │    MOVQ  $42, 8(SP)        │ ← store length
│           │    ...                      │
├───────────┴────────────────────────────┤
│  .rodata  │  53 45 4c 45 43 54 2e 2e.  │ ← "SELECT..." bytes
│           │  (string data, immutable)  │
└────────────────────────────────────────┘
```

The OS maps `.rodata` as read-only memory (using `mmap` with `PROT_READ`). Any attempt to write to this memory causes a segfault (SIGSEGV), which is how Go enforces string immutability for literals.

---

## 7. The Go Specification (Exact Text)

From the Go Language Specification:

```
raw_string_lit         = "`" { unicode_char | newline } "`" .
unicode_char           = /* an arbitrary Unicode code point except newline */ .
newline                = /* the Unicode code point U+000A */ .

The value of a raw string literal is the string composed of the
uninterpreted (implicitly UTF-8 encoded) characters between the quotes;
in particular, backslashes have no special meaning and the string may
contain newlines. Carriage return characters ('\r') inside raw string
literals are discarded from the raw string value.
```

Note: the spec says `unicode_char | newline` in the grammar — both Unicode characters AND newlines are allowed. The only exception is the backtick itself (which ends the literal) and `\r` (which is stripped).

---

## 8. Compiler Constant Propagation

The Go compiler propagates string constants aggressively:

```go
// These are identical at the compiler level:
const A = `hello`
const B = `hello`

// The compiler may (but is not required to) merge A and B
// to point to the same .rodata address
// This is "string interning" at the compiler level

// Test:
import "unsafe"
pa := *(*uintptr)(unsafe.Pointer(&A))
pb := *(*uintptr)(unsafe.Pointer(&B))
fmt.Println(pa == pb) // may be true (compiler-dependent)
```

---

## 9. Difference from Interpreted Literals in the Compiler

```
Step 1: Lexer
  Raw:          `\n`  → token.STRING value "`\n`"     (keeps backslash-n)
  Interpreted:  "\n"  → token.STRING value "\"\\n\""  (keeps escape notation)

Step 2: Constant evaluation (src/cmd/compile/internal/constant)
  Raw:          "`\n`"   → strconv.Unquote("`\n`")   → "\\" + "n" (2 bytes)
  Interpreted:  "\"\\n\"" → strconv.Unquote("\"\\n\"") → "\n"      (1 byte, linefeed)

Step 3: Code generation
  Raw:          .rodata: 5c 6e          (2 bytes)
  Interpreted:  .rodata: 0a            (1 byte)
```

Both use `strconv.Unquote` internally, but the function behavior differs based on the delimiter:
- Backtick delimiter: no escape processing (except `\r` removal)
- Double-quote delimiter: full escape processing

---

## 10. strconv.Unquote Implementation

```go
// src/strconv/quote.go (simplified)
func Unquote(s string) (string, error) {
    n := len(s)
    if n < 2 {
        return "", ErrSyntax
    }
    quote := s[0]
    if quote != s[n-1] {
        return "", ErrSyntax
    }
    s = s[1 : n-1]

    if quote == '`' {
        // Raw string: no processing except \r removal
        if contains(s, '`') {
            return "", ErrSyntax
        }
        if contains(s, '\r') {
            var buf strings.Builder
            for _, r := range s {
                if r != '\r' {
                    buf.WriteRune(r)
                }
            }
            return buf.String(), nil
        }
        return s, nil  // fast path: no allocation needed
    }
    // ...handle double-quoted strings with escape processing...
}
```

---

## 11. Raw String Literals and the Go Toolchain

### go vet and Raw Strings

```bash
# go vet checks for common mistakes but doesn't analyze raw string content
# For regex-specific linting:
go install github.com/kisielk/errcheck@latest

# For raw string unused import detection:
go build ./... 2>&1  # will catch syntax errors in raw string regex patterns
# (regexp.MustCompile with invalid pattern panics at init time)
```

### Raw Strings in go generate

```go
//go:generate go run gen.go
// gen.go might use raw strings as code templates:

const methodTemplate = `
func (s *{{.Type}}) {{.Name}}({{.Params}}) {{.Returns}} {
    {{.Body}}
}
`
```

---

## 12. UTF-8 Compliance

The Go spec says raw strings are "implicitly UTF-8 encoded." However:

```go
// A raw string CAN contain non-UTF-8 bytes if your source file is not UTF-8
// (though Go source files are required to be UTF-8 by the spec)

// The Go lexer processes source as UTF-8
// A non-UTF-8 byte in a raw string will cause a compile error:
// error: non-UTF-8 source file (invalid UTF-8 encoding)

// So in practice, raw strings are always valid UTF-8
// (unlike runtime-created strings which can hold any bytes)
```

---

## 13. Interaction with reflect Package

```go
import "reflect"

s := `hello`
v := reflect.ValueOf(s)
fmt.Println(v.Kind())   // string
fmt.Println(v.Len())    // 5
fmt.Println(v.String()) // hello

// The reflect package sees no difference between raw and interpreted strings
// Both are just type=string with identical internal structure
```

---

## 14. Further Reading

- `src/go/scanner/scanner.go` — Raw string scanning implementation
- `src/strconv/quote.go` — `Unquote` implementation
- `src/go/constant/value.go` — Constant evaluation for strings
- [Go Spec: Lexical elements](https://go.dev/ref/spec#Lexical_elements)
- [Go Spec: Raw string literals grammar](https://go.dev/ref/spec#String_literals)
- `src/cmd/compile/internal/` — Compiler internals

---

## Summary

Raw string literals in Go's compiler pipeline:
1. **Lexer**: Scans bytes between backticks, strips `\r`, produces `token.STRING`
2. **Parser**: Creates `ast.BasicLit{Kind: token.STRING, Value: "`...`"}`
3. **Constant evaluation**: `strconv.Unquote` returns the bytes as-is (minus `\r`)
4. **Code generation**: Bytes stored in `.rodata` as read-only memory
5. **Runtime**: Identical to interpreted strings — just a `{ptr, len}` struct

The "raw" nature is purely a compile-time concept — there is no runtime mechanism to distinguish a raw string from an interpreted string.
