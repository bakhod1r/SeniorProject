# Interpreted String Literals — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §String_literals (interpreted string literals section)

## Table of Contents
1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar](#2-formal-grammar)
3. [Core Rules](#3-core-rules)
4. [Type Rules](#4-type-rules)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Defined vs Undefined Behavior](#6-defined-vs-undefined-behavior)
7. [Edge Cases from Spec](#7-edge-cases-from-spec)
8. [Version History](#8-version-history)
9. [Implementation-Specific Behavior](#9-implementation-specific-behavior)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Spec Sections](#12-related-spec-sections)

---

## 1. Spec Reference

### Interpreted String Literals (from Go Language Specification)

> Interpreted string literals are character sequences between double quotes, as in `"bar"`. Within the quotes, any character may appear except **newline** and **unescaped double quote**. The text between the quotes forms the value of the literal, with backslash escapes interpreted as they are in rune literals (except that `\'` is illegal and `\"` is legal), with the same restrictions. The three-digit octal (`\nnn`) and two-digit hexadecimal (`\xnn`) escapes represent individual bytes of the resulting string; all other escapes represent the (possibly multi-byte) UTF-8 encoding of individual characters. Thus inside a string literal `\377` and `\xFF` represent a single byte of value `0xFF=255`, while `ÿ`, `\u00FF`, `\U000000FF` and `\xc3\xbf` represent the two bytes `0xc3 0xbf` of the UTF-8 encoding of character U+00FF.

### Official Examples from the Spec

```
`abc`                // same as "abc"
`\n
\n`                  // same as "\\n\n\\n"
"\n"
"\""                 // same as `"`
"Hello, world!\n"
"日本語"
"\u65e5本\U00008a9e"
"\xff\u00FF"
"\uD800"             // illegal: surrogate half
"\U00110000"         // illegal: invalid Unicode code point
```

These examples all represent the same string:

```
"日本語"                                 // UTF-8 input text
`日本語`                                 // UTF-8 input text as a raw literal
"\u65e5\u672c\u8a9e"                    // the explicit Unicode code points
"\U000065e5\U0000672c\U00008a9e"        // the explicit Unicode code points
"\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e"  // the explicit UTF-8 bytes
```

---

## 2. Formal Grammar

From the Go specification:

```ebnf
string_lit             = raw_string_lit | interpreted_string_lit .
interpreted_string_lit = `"` { unicode_value | byte_value } `"` .

unicode_value    = unicode_char | little_u_value | big_u_value | escaped_char .
byte_value       = octal_byte_value | hex_byte_value .
octal_byte_value = `\` octal_digit octal_digit octal_digit .
hex_byte_value   = `\` "x" hex_digit hex_digit .
little_u_value   = `\` "u" hex_digit hex_digit hex_digit hex_digit .
big_u_value      = `\` "U" hex_digit hex_digit hex_digit hex_digit
                           hex_digit hex_digit hex_digit hex_digit .
escaped_char     = `\` ( "a" | "b" | "f" | "n" | "r" | "t" | "v" | `\` | "'" | `"` ) .
```

### Valid Escape Sequences in Interpreted String Literals

| Escape | Unicode | Description |
|--------|---------|-------------|
| `\a` | U+0007 | Alert or bell |
| `\b` | U+0008 | Backspace |
| `\f` | U+000C | Form feed |
| `\n` | U+000A | Line feed (newline) |
| `\r` | U+000D | Carriage return |
| `\t` | U+0009 | Horizontal tab |
| `\v` | U+000B | Vertical tab |
| `\\` | U+005C | Backslash |
| `\"` | U+0022 | Double quote |
| `\OOO` | variable | Octal byte value (exactly 3 digits, 0–255) |
| `\xHH` | variable | Hex byte value (exactly 2 hex digits) |
| `\uHHHH` | variable | Unicode code point (exactly 4 hex digits) |
| `\UHHHHHHHH` | variable | Unicode code point (exactly 8 hex digits) |

Note: `\'` (single quote) is **ILLEGAL** in interpreted string literals (valid only in rune literals).

---

## 3. Core Rules

### Rule 1: Double-Quote Delimited
Interpreted string literals are enclosed in double quotes `"..."`. The double-quote character must be escaped as `\"` inside the literal.

### Rule 2: No Literal Newlines
> Within the quotes, any character may appear except **newline** and **unescaped double quote**.

A literal newline inside double quotes is a **compile error**. Use `\n` escape instead.

```go
// COMPILE ERROR: newline in string
// s := "line1
// line2"

s := "line1\nline2"  // correct
```

### Rule 3: Escape Sequences Are Processed
Unlike raw string literals, backslash escape sequences are interpreted:
```go
"\n"   // one byte: 0x0A (newline)
"\t"   // one byte: 0x09 (tab)
"\\"   // one byte: 0x5C (backslash)
```

### Rule 4: \OOO and \xHH Are Byte Escapes
Octal (`\nnn`) and hex (`\xnn`) escapes produce **individual bytes**:
```go
"\xff"   // one byte: 0xFF
"\377"   // one byte: 0xFF (same value, octal 377 = decimal 255)
```

These do NOT represent Unicode code points — they are raw bytes inserted into the string.

### Rule 5: \u and \U Are Unicode Code Point Escapes
`\uHHHH` and `\UHHHHHHHH` produce the **UTF-8 encoding** of the specified Unicode code point:
```go
"\u00FF"  // two bytes: 0xC3 0xBF (UTF-8 for U+00FF ÿ)
"\xFF"    // one byte: 0xFF (raw byte, NOT UTF-8 for U+00FF)
```

The spec explicitly notes:
> `\377` and `\xFF` represent a single byte of value `0xFF=255`, while `ÿ`, `\u00FF`, `\U000000FF` and `\xc3\xbf` represent the two bytes `0xc3 0xbf` of the UTF-8 encoding of character U+00FF.

---

## 4. Type Rules

### Type of Interpreted String Literal
An interpreted string literal is an **untyped string constant**. It can be assigned to any string type.

```go
var s string = "hello"
type MyString string
var m MyString = "hello"   // valid: untyped constant
```

### Equality with Raw String Literals
If a raw string literal and an interpreted string literal produce the same byte sequence, they are equal:

```go
fmt.Println("abc" == `abc`)  // true
fmt.Println("\"" == "`\"" + "`")  // demonstrates escape comparison
```

### Constant Folding
String constant expressions with only other string constants are evaluated at compile time:
```go
const prefix = "Hello, "
const name = "World"
const greeting = prefix + name  // "Hello, World" — compile-time constant
```

---

## 5. Behavioral Specification

### Byte Escapes vs Unicode Escapes
The spec distinguishes two categories:

**Byte escapes** (`\OOO` and `\xHH`):
- Produce individual bytes in the string
- No Unicode interpretation
- Range: 0x00–0xFF

**Unicode escapes** (`\uHHHH` and `\UHHHHHHHH`):
- Produce the UTF-8 encoding of the code point
- Must be a valid Unicode code point
- `\u`: range U+0000 to U+FFFF
- `\U`: range U+000000 to U+10FFFF (minus surrogate halves)

### Mixing Byte and Unicode Escapes
You can mix them freely in one string:
```go
s := "\xff\u00FF"
// \xff = one byte: 0xFF
// \u00FF = two bytes: 0xC3 0xBF (UTF-8 for U+00FF)
// Total: 3 bytes: [0xFF, 0xC3, 0xBF]
```

Note: The result (`[0xFF, 0xC3, 0xBF]`) is NOT valid UTF-8 because 0xFF is not a valid UTF-8 leading byte.

### Surrogate Halves Are Invalid
```go
"\uD800"    // COMPILE ERROR: surrogate half
"\uDFFF"    // COMPILE ERROR: surrogate half
```

Unicode surrogates (U+D800 to U+DFFF) are reserved for UTF-16 encoding pairs. They are not valid code points in UTF-8 or in Go strings.

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Expression | Bytes | Notes |
|------------|-------|-------|
| `"\n"` | `[0x0A]` | newline |
| `"\t"` | `[0x09]` | tab |
| `"\\"` | `[0x5C]` | backslash |
| `"\""` | `[0x22]` | double quote |
| `"\377"` | `[0xFF]` | max octal byte |
| `"\xff"` | `[0xFF]` | max hex byte |
| `"\u00FF"` | `[0xC3, 0xBF]` | UTF-8 for U+00FF |
| `"\U000000FF"` | `[0xC3, 0xBF]` | same |
| `"ÿ"` | `[0xC3, 0xBF]` | same (literal UTF-8) |
| `"\uD800"` | — | COMPILE ERROR: surrogate |
| `"\U00110000"` | — | COMPILE ERROR: invalid code point |
| Literal newline in `""` | — | COMPILE ERROR |

### Compile Errors (Not Runtime)
All invalid escape sequences and invalid code points are caught at **compile time**, not runtime.

---

## 7. Edge Cases from Spec

### Edge Case 1: \xff vs \u00FF (Critical Distinction)
From the spec:
> `\377` and `\xFF` represent a single byte of value `0xFF=255`, while `ÿ`, `\u00FF`, `\U000000FF` and `\xc3\xbf` represent the two bytes `0xc3 0xbf` of the UTF-8 encoding of character U+00FF.

```go
a := "\xff"      // 1 byte: [0xFF]
b := "\u00FF"    // 2 bytes: [0xC3, 0xBF]
c := "ÿ"         // 2 bytes: [0xC3, 0xBF] (literal UTF-8 in source)

fmt.Println(len(a), len(b), len(c))  // 1, 2, 2
fmt.Println(a == b)  // false! Different byte counts
fmt.Println(b == c)  // true! Same UTF-8 bytes
```

### Edge Case 2: Multiple Representations of Same String (from Spec)
All of these represent the string "日本語":
```go
s1 := "日本語"
s2 := `日本語`
s3 := "\u65e5\u672c\u8a9e"
s4 := "\U000065e5\U0000672c\U00008a9e"
s5 := "\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e"
// All equal: s1==s2==s3==s4==s5
```

### Edge Case 3: \' Is Illegal in Strings
The single-quote escape `\'` is valid in rune literals but **not** in string literals:
```go
r := '\''    // valid in rune literal
// s := "\'"  // COMPILE ERROR in string literal
s := "'"     // correct: just use the character directly
```

### Edge Case 4: Unrecognized Escape
Any backslash not followed by a recognized escape character is a compile error:
```go
// "\k"  // COMPILE ERROR: k is not a recognized escape
// "\c"  // COMPILE ERROR
```

### Edge Case 5: `\0` — Too Few Octal Digits
Octal escapes require exactly 3 digits:
```go
// "\0"   // COMPILE ERROR: too few octal digits
"\00"  // COMPILE ERROR: too few octal digits
"\000" // valid: NUL byte
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Interpreted string literals with all escape forms |
| Go 1.0 | `\u` and `\U` Unicode escapes |
| Go 1.0 | `\xHH` and `\OOO` byte escapes |
| Go 1.0 | Surrogate halves forbidden in `\u` and `\U` escapes |

No changes to interpreted string literal semantics since Go 1.0.

---

## 9. Implementation-Specific Behavior

### Compile-Time Constant
Interpreted string literals are processed entirely at compile time. The resulting byte sequence is embedded in the binary. No runtime escape processing occurs.

### Memory (gc compiler)
String constants are stored in the read-only data segment (`.rodata`). Multiple references to the same string constant may share the same memory address (implementation-defined optimization).

### Encoding
Go source files are UTF-8. When you write `"日本語"` in source code, the bytes `0xe6 0x97 0xa5 0xe6 0x9c 0xac 0xe8 0xaa 0x9e` are embedded directly in the binary — identical to the explicit `"\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e"` form.

---

## 10. Spec Compliance Checklist

- [ ] Interpreted string literals are enclosed in double quotes `"..."`
- [ ] Literal newline inside `"..."` is a compile error — use `\n`
- [ ] Unescaped double quote inside `"..."` is a compile error — use `\"`
- [ ] `\'` (single quote escape) is ILLEGAL in string literals
- [ ] `\"` (double quote escape) is legal only in string literals (not rune literals)
- [ ] `\a \b \f \n \r \t \v \\ \"` are the named escape sequences
- [ ] `\OOO` (octal, 3 digits, 0–255) produces a single raw byte
- [ ] `\xHH` (hex, 2 digits) produces a single raw byte
- [ ] `\uHHHH` (4 hex digits) produces UTF-8 encoding of the code point
- [ ] `\UHHHHHHHH` (8 hex digits) produces UTF-8 encoding of the code point
- [ ] Surrogate halves (`\uD800`–`\uDFFF`) are compile errors
- [ ] Values > U+10FFFF in `\U` are compile errors
- [ ] `\xff` ≠ `\u00FF` (different byte sequences!)
- [ ] All five representations of "日本語" are equal (from spec)
- [ ] Result is an untyped string constant

---

## 11. Official Examples

### Example 1: Escape Sequences and Their Byte Values

```go
package main

import "fmt"

func main() {
    // Named escape sequences
    fmt.Printf("%q -> % X\n", "\a", "\a")  // "\a"  -> 07
    fmt.Printf("%q -> % X\n", "\b", "\b")  // "\b"  -> 08
    fmt.Printf("%q -> % X\n", "\f", "\f")  // "\f"  -> 0C
    fmt.Printf("%q -> % X\n", "\n", "\n")  // "\n"  -> 0A
    fmt.Printf("%q -> % X\n", "\r", "\r")  // "\r"  -> 0D
    fmt.Printf("%q -> % X\n", "\t", "\t")  // "\t"  -> 09
    fmt.Printf("%q -> % X\n", "\v", "\v")  // "\v"  -> 0B
    fmt.Printf("%q -> % X\n", "\\", "\\")  // "\\"  -> 5C
    fmt.Printf("%q -> % X\n", "\"", "\"")  // "\""  -> 22

    // Numeric escapes
    fmt.Printf("octal  \\101 = %c\n", "\101")   // A
    fmt.Printf("hex    \\x41 = %c\n", "\x41")   // A
    fmt.Printf("unicode \\u0041 = %c\n", "\u0041") // A
    fmt.Printf("unicode \\U00000041 = %c\n", "\U00000041") // A
}
```

### Example 2: Critical Distinction — \xff vs \u00FF (from Spec)

```go
package main

import "fmt"

func main() {
    // \xff: single raw byte 0xFF
    a := "\xff"
    fmt.Printf("\\xff: len=%d, bytes=%X\n", len(a), []byte(a))
    // len=1, bytes=[FF]

    // \u00FF: UTF-8 encoding of U+00FF (ÿ) = two bytes
    b := "\u00FF"
    fmt.Printf("\\u00FF: len=%d, bytes=%X\n", len(b), []byte(b))
    // len=2, bytes=[C3 BF]

    // Literal ÿ: same UTF-8 bytes as \u00FF
    c := "ÿ"
    fmt.Printf("ÿ: len=%d, bytes=%X\n", len(c), []byte(c))
    // len=2, bytes=[C3 BF]

    fmt.Println("\\xff == \\u00FF:", a == b)  // false
    fmt.Println("\\u00FF == ÿ:", b == c)      // true
    fmt.Println("\\xff == \\u00FF or ÿ:", a == b || a == c) // false
}
```

### Example 3: Five Representations of "日本語" (from Spec)

```go
package main

import "fmt"

func main() {
    // From the Go specification — all five are identical strings:
    s1 := "日本語"
    s2 := `日本語`
    s3 := "\u65e5\u672c\u8a9e"
    s4 := "\U000065e5\U0000672c\U00008a9e"
    s5 := "\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e"

    fmt.Println(s1 == s2) // true
    fmt.Println(s2 == s3) // true
    fmt.Println(s3 == s4) // true
    fmt.Println(s4 == s5) // true

    fmt.Printf("bytes: % X\n", []byte(s1))
    // E6 97 A5 E6 9C AC E8 AA 9E  (9 bytes for 3 runes)
}
```

### Example 4: Building Strings with Escape Sequences

```go
package main

import "fmt"

func main() {
    // Tab-separated values
    tsv := "Name\tAge\tEmail\nAlice\t30\talice@example.com\nBob\t25\tbob@example.com"
    fmt.Println(tsv)

    // JSON with embedded escaping
    json := "{\"name\": \"Alice\", \"age\": 30}"
    fmt.Println(json)
    // Compare with raw string:
    jsonRaw := `{"name": "Alice", "age": 30}`
    fmt.Println(json == jsonRaw) // true

    // Null byte in string (valid in Go!)
    withNull := "before\x00after"
    fmt.Printf("len=%d, bytes=%X\n", len(withNull), []byte(withNull))
    // len=12, bytes=[62 65 66 6F 72 65 00 61 66 74 65 72]
}
```

### Example 5: Illegal Escape Sequences (These Are Compile Errors)

```go
package main

// This file demonstrates what is ILLEGAL in interpreted string literals.
// All commented-out lines would cause compile errors.

func main() {
    // Literal newline in double-quoted string:
    // _ = "line1
    // line2"  // COMPILE ERROR: newline in string

    // Unrecognized escape:
    // _ = "\k"  // COMPILE ERROR: unknown escape sequence

    // Single quote escape (valid in rune, not string):
    // _ = "\'"  // COMPILE ERROR

    // Surrogate halves:
    // _ = "\uD800"    // COMPILE ERROR: surrogate half
    // _ = "\uDFFF"    // COMPILE ERROR: surrogate half

    // Invalid Unicode code point:
    // _ = "\U00110000" // COMPILE ERROR: invalid Unicode code point

    // Too few octal digits:
    // _ = "\0"   // COMPILE ERROR: too few octal digits
    // _ = "\00"  // COMPILE ERROR: too few octal digits

    // Too few hex digits:
    // _ = "\x1"  // COMPILE ERROR: too few hex digits

    // All valid — for reference
    _ = "\n"       // newline
    _ = "\t"       // tab
    _ = "\000"     // NUL (3 octal digits)
    _ = "\x00"     // NUL (2 hex digits)
    _ = "\u0000"   // NUL (4 unicode hex digits)
    _ = "\U00000000" // NUL (8 unicode hex digits)
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| String literals | https://go.dev/ref/spec#String_literals | Full spec (raw + interpreted) |
| String types | https://go.dev/ref/spec#String_types | Immutable byte sequence |
| Rune literals | https://go.dev/ref/spec#Rune_literals | Same escape syntax (with differences) |
| Raw string literals | https://go.dev/ref/spec#String_literals | Counterpart with no escapes |
| Source code representation | https://go.dev/ref/spec#Source_code_representation | UTF-8 source encoding |
| Constants | https://go.dev/ref/spec#Constants | String literals as constants |
| Conversions | https://go.dev/ref/spec#Conversions | `string`↔`[]byte`↔`[]rune` |
| unicode/utf8 | https://pkg.go.dev/unicode/utf8 | ValidString, RuneCount |
| fmt package | https://pkg.go.dev/fmt | %q, %X for string inspection |
