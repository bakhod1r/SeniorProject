# Runes — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Rune_literals + §Numeric_types (rune/byte section) + §Source_code_representation

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

### Rune Type (from Go Language Specification — Numeric Types)

> ```
> byte        alias for uint8
> rune        alias for int32
> ```

`rune` is a predeclared alias for `int32`. It represents a Unicode code point. The `rune` alias was introduced to make code more readable when working with Unicode characters.

### Rune Literals (from Go Language Specification)

> A rune literal represents a rune constant, an integer value identifying a Unicode code point. A rune literal is expressed as one or more characters enclosed in single quotes, as in `'x'` or `'\n'`. Within the quotes, any character may appear except newline and unescaped single quote. A single quoted character represents the Unicode value of the character itself, while multi-character sequences beginning with a backslash encode values in various formats.
>
> The simplest form represents the single character within the quotes; since Go source text is Unicode characters encoded in UTF-8, multiple UTF-8-encoded bytes may represent a single integer value. For instance, the literal `'a'` holds a single byte representing a literal `a`, Unicode U+0061, value `0x61`, while `'ä'` holds two bytes (`0xc3 0xa4`) representing a literal a-dieresis, U+00E4, value `0xe4`.
>
> Several backslash escapes allow arbitrary values to be encoded as ASCII text. There are four ways to represent the integer value as a numeric constant: `\x` followed by exactly two hexadecimal digits; `\u` followed by exactly four hexadecimal digits; `\U` followed by exactly eight hexadecimal digits, and a plain backslash `\` followed by exactly three octal digits. In each case the value of the literal is the value represented by the digits in the corresponding base.
>
> Although these representations all result in an integer, they have different valid ranges. Octal escapes must represent a value between 0 and 255 inclusive. Hexadecimal escapes satisfy this condition by construction. The escapes `\u` and `\U` represent Unicode code points so within them some values are illegal, in particular those above `0x10FFFF` and surrogate halves.

### Escape Sequences (from Go Language Specification)

> After a backslash, certain single-character escapes represent special values:
>
> ```
> \a   U+0007 alert or bell
> \b   U+0008 backspace
> \f   U+000C form feed
> \n   U+000A line feed or newline
> \r   U+000D carriage return
> \t   U+0009 horizontal tab
> \v   U+000B vertical tab
> \\   U+005C backslash
> \'   U+0027 single quote  (valid escape only within rune literals)
> \"   U+0022 double quote  (valid escape only within string literals)
> ```
>
> An unrecognized character following a backslash in a rune literal is illegal.

---

## 2. Formal Grammar

From the Go specification:

```ebnf
rune_lit         = "'" ( unicode_value | byte_value ) "'" .
unicode_value    = unicode_char | little_u_value | big_u_value | escaped_char .
byte_value       = octal_byte_value | hex_byte_value .
octal_byte_value = `\` octal_digit octal_digit octal_digit .
hex_byte_value   = `\` "x" hex_digit hex_digit .
little_u_value   = `\` "u" hex_digit hex_digit hex_digit hex_digit .
big_u_value      = `\` "U" hex_digit hex_digit hex_digit hex_digit
                           hex_digit hex_digit hex_digit hex_digit .
escaped_char     = `\` ( "a" | "b" | "f" | "n" | "r" | "t" | "v" | `\` | "'" | `"` ) .
```

### Escape Sequence Summary

| Escape | Format | Digits | Value Range |
|--------|--------|--------|-------------|
| `\a` | Named | — | U+0007 (bell) |
| `\b` | Named | — | U+0008 (backspace) |
| `\f` | Named | — | U+000C (form feed) |
| `\n` | Named | — | U+000A (newline) |
| `\r` | Named | — | U+000D (carriage return) |
| `\t` | Named | — | U+0009 (tab) |
| `\v` | Named | — | U+000B (vertical tab) |
| `\\` | Named | — | U+005C (backslash) |
| `\'` | Named | — | U+0027 (single quote, rune only) |
| `\"` | Named | — | U+0022 (double quote, string only) |
| `\OOO` | Octal | 3 | 0–255 |
| `\xHH` | Hex | 2 | 0x00–0xFF |
| `\uHHHH` | Unicode | 4 | U+0000–U+FFFF |
| `\UHHHHHHHH` | Unicode | 8 | U+000000–U+10FFFF (valid code points) |

---

## 3. Core Rules

### Rule 1: rune = int32 (Alias, Not Defined Type)
`rune` is a **type alias** for `int32`, declared as:
```go
type rune = int32  // alias declaration
```

This means `rune` and `int32` are **identical types** — no conversion needed between them.

### Rule 2: Unicode Code Point
A `rune` value is a Unicode code point. Unicode code points range from U+000000 to U+10FFFF (1,114,112 possible values), well within the range of `int32` (-2,147,483,648 to 2,147,483,647).

### Rule 3: Single Character in Single Quotes
A rune literal is a single character (or escape sequence) enclosed in single quotes `'`. It yields an **untyped rune constant** (which is an untyped integer constant with default type `rune`).

### Rule 4: Invalid Escape Sequences Are Compile Errors
Any unrecognized character after a backslash is a compile error:
```go
'\k'   // COMPILE ERROR: k is not recognized after a backslash
```

### Rule 5: Only One Character Per Rune Literal
A rune literal may contain only one Unicode character or one escape sequence:
```go
'aa'   // COMPILE ERROR: too many characters
'\u0061\u0062'  // COMPILE ERROR: too many characters
```

---

## 4. Type Rules

### rune as int32 Alias
| Expression | Type |
|------------|------|
| `'a'` | untyped rune constant (default type: `rune`) |
| `var r rune` | `rune` (= `int32`) |
| `r := 'a'` | `rune` |
| `int32('a')` | `int32` — no conversion needed (same type) |
| `rune(65)` | `rune` — valid (just assigns the integer value) |

### Assignment Between rune and int32
Since `rune` is an alias for `int32` (not a defined type), they are interchangeable:
```go
var r rune  = 'A'
var i int32 = r    // valid, no conversion
r = i              // valid, no conversion
```

This is different from `type MyRune int32` which would be a new defined type requiring explicit conversions.

### Valid Unicode Code Points
Not all `int32` values are valid Unicode code points. From the spec:
- Values above `0x10FFFF` are invalid
- Surrogate halves (`U+D800` to `U+DFFF`) are invalid in rune literals

```go
'\uDFFF'      // COMPILE ERROR: surrogate half
'\U00110000'  // COMPILE ERROR: invalid Unicode code point
'\U0010FFFF'  // valid: last valid Unicode code point
```

---

## 5. Behavioral Specification

### UTF-8 Encoding and rune Decoding
Go source files are UTF-8 encoded. When iterating over a string with `range`, Go decodes UTF-8 and yields `rune` values:

```go
for i, r := range "Hello, 世界" {
    // i: byte index
    // r: rune (Unicode code point)
}
```

Each ASCII character (`U+0000` to `U+007F`) is encoded in 1 byte. Characters outside ASCII require 2–4 bytes in UTF-8.

### Byte Value Escapes Represent Bytes, Not Code Points
`\xHH` and `\OOO` escapes in rune literals produce the integer value directly (0–255). They do not represent a UTF-8 sequence:

```go
'\xff'   // rune with value 0xFF (255) — NOT the UTF-8 sequence for U+00FF
'\u00FF' // rune with value 0xFF (255) — this IS U+00FF (ÿ)
```

These produce the same integer value (255) but conceptually differ.

### Octal Escape Range
Octal escapes (`\OOO`) must be between 0 and 255 (octal: `\000` to `\377`):
```go
'\377'   // valid: 0xFF = 255
'\400'   // COMPILE ERROR: octal value over 255
```

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Behavior | Specification Rule |
|----------|-------------------|
| `rune` == `int32` | Aliases — identical types, no conversion |
| `'a'` value | 97 (U+0061) |
| `'\n'` value | 10 (U+000A) |
| `'\xff'` value | 255 |
| Surrogate halves | Invalid in rune literals (compile error) |
| Values > U+10FFFF | Invalid in rune literals (compile error) |
| `'\0'` | COMPILE ERROR: too few octal digits |
| `'\000'` | Valid: NUL byte, value 0 |
| `range` over string | Yields (byte_index, rune) pairs |

### Behavior of Invalid UTF-8 in Strings
When iterating over a string with `range`, invalid UTF-8 sequences produce:
- `rune` value `0xFFFD` (Unicode replacement character U+FFFD)
- Advance by 1 byte

---

## 7. Edge Cases from Spec

### Edge Case 1: Multi-Byte Literal 'ä'
```go
r := 'ä'  // U+00E4, value 0xe4 = 228
// 'ä' is TWO UTF-8 bytes (0xc3 0xa4) but ONE code point
fmt.Println(r)               // 228
fmt.Println(string(r))       // "ä"
fmt.Println(len(string(r)))  // 2 (bytes, not runes)
```

### Edge Case 2: rune Literal vs byte Value
`'\xff'` is valid in a rune literal (value 255), but it's a byte value, not a valid Unicode code point in the usual sense:
```go
r1 := '\xff'    // value 255, type rune
r2 := '\u00ff'  // value 255, type rune — same integer value, but this IS U+00FF (ÿ)
fmt.Println(r1 == r2)  // true (both have value 255)
```

### Edge Case 3: 0o123i-style Confusion
Rune literals cannot have multiple characters:
```go
// '本語'  // COMPILE ERROR: too many characters
```

To get the rune of '本', use just `'本'`:
```go
r := '本'  // U+672C, value 26924
```

### Edge Case 4: rune in range Loop
```go
s := "Hello"
for i, r := range s {
    fmt.Printf("s[%d] = %c (U+%04X)\n", i, r, r)
}
```

### Edge Case 5: Converting Integer to String
A `rune` value converted to `string` yields the UTF-8 encoding of that code point:
```go
fmt.Println(string(rune(65)))    // "A"
fmt.Println(string(rune(0x4e16))) // "世"
fmt.Println(string(rune(-1)))    // "\uFFFD" (invalid code point → replacement char)
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `rune` alias for `int32` introduced |
| Go 1.0 | Rune literal syntax with all escape forms |
| Go 1.0 | `range` over string yields (int, rune) pairs |
| Go 1.9 | `rune` explicitly documented as a type alias (`type rune = int32`) |
| Go 1.15 | `unicode/utf8` package functions for rune encoding/decoding |

---

## 9. Implementation-Specific Behavior

### Memory
- `rune` is an alias for `int32` — same memory representation: 4 bytes, 4-byte aligned
- `unsafe.Sizeof(rune(0))` == 4

### UTF-8 Decoding in range
The `range` loop over a string uses `utf8.DecodeRuneInString` semantics:
- Invalid UTF-8 sequences yield `RuneError` (U+FFFD) and advance 1 byte
- Valid sequences yield the decoded rune and advance `utf8.RuneLen(r)` bytes (1–4)

### math/bits vs unicode/utf8
Use `unicode/utf8` package for rune-related operations:
- `utf8.RuneLen(r rune) int` — bytes needed to encode rune
- `utf8.EncodeRune(p []byte, r rune) int` — encode rune to bytes
- `utf8.DecodeRune(p []byte) (rune, int)` — decode rune from bytes
- `utf8.ValidRune(r rune) bool` — check if valid Unicode code point

---

## 10. Spec Compliance Checklist

- [ ] `rune` is a type alias for `int32` (not a defined type)
- [ ] `rune` and `int32` are interchangeable without conversion
- [ ] Rune literal is a single character or escape sequence in single quotes
- [ ] Valid named escapes: `\a \b \f \n \r \t \v \\ \' \"`
- [ ] `\'` is valid only in rune literals (not string literals)
- [ ] `\"` is valid only in string literals (not rune literals)
- [ ] `\xHH`: exactly 2 hex digits, value 0–255
- [ ] `\OOO`: exactly 3 octal digits, value 0–255 (`\000` to `\377`)
- [ ] `\uHHHH`: exactly 4 hex digits, valid Unicode code point
- [ ] `\UHHHHHHHH`: exactly 8 hex digits, valid Unicode code point
- [ ] Surrogate halves (U+D800–U+DFFF) are invalid rune literals
- [ ] Values > U+10FFFF are invalid rune literals
- [ ] Multiple characters in single quotes is a compile error
- [ ] `range` over string yields (byte_index, rune) pairs
- [ ] Invalid UTF-8 in string range → U+FFFD + advance 1 byte

---

## 11. Official Examples

### Example 1: Valid and Invalid Rune Literals (from Spec)

```go
package main

import "fmt"

func main() {
    // Valid rune literals from the Go specification
    fmt.Println('a')         // 97
    fmt.Println('ä')         // 228 (U+00E4, 2 UTF-8 bytes)
    fmt.Println('本')        // 26412 (U+672C, 3 UTF-8 bytes)
    fmt.Println('\t')        // 9 (horizontal tab)
    fmt.Println('\000')      // 0 (NUL)
    fmt.Println('\007')      // 7 (bell)
    fmt.Println('\377')      // 255 (max octal byte)
    fmt.Println('\x07')      // 7 (hex: bell)
    fmt.Println('\xff')      // 255
    fmt.Println('\u12e4')    // 4836 (U+12E4 ሤ)
    fmt.Println('\U00101234') // 1053236 (U+101234)
    fmt.Println('\'')        // 39 (single quote)

    // Invalid (would be compile errors):
    // 'aa'         -- too many characters
    // '\k'         -- k is not recognized
    // '\xa'        -- too few hex digits
    // '\0'         -- too few octal digits
    // '\400'       -- octal value over 255
    // '\uDFFF'     -- surrogate half
    // '\U00110000' -- invalid Unicode code point
}
```

### Example 2: rune as int32 Alias

```go
package main

import "fmt"

func main() {
    // rune and int32 are identical types (aliases)
    var r rune  = 'A'
    var i int32 = r    // no conversion needed
    r = i              // no conversion needed

    fmt.Println(r, i)              // 65 65
    fmt.Printf("%T %T\n", r, i)   // int32 int32

    // Arithmetic is possible since rune is int32
    next := r + 1
    fmt.Printf("%c = %d\n", next, next) // B = 66
}
```

### Example 3: Escape Sequences

```go
package main

import "fmt"

func main() {
    // Named escapes
    fmt.Printf("alert: %c (U+%04X)\n",    '\a', '\a')  // U+0007
    fmt.Printf("backspace: %c (U+%04X)\n", '\b', '\b') // U+0008
    fmt.Printf("form feed: %c (U+%04X)\n", '\f', '\f') // U+000C
    fmt.Printf("newline: (U+%04X)\n",       '\n')       // U+000A
    fmt.Printf("carriage return: (U+%04X)\n", '\r')     // U+000D
    fmt.Printf("tab: %c (U+%04X)\n",        '\t', '\t') // U+0009

    // Numeric escapes
    fmt.Printf("octal \\101 = %c\n", '\101')   // 'A' (octal 101 = decimal 65)
    fmt.Printf("hex \\x41 = %c\n",   '\x41')   // 'A'
    fmt.Printf("\\u0041 = %c\n",     '\u0041') // 'A'
    fmt.Printf("\\U00000041 = %c\n", '\U00000041') // 'A'
}
```

### Example 4: Iterating Over String with range

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"

    // range yields (byte_index, rune) pairs
    for i, r := range s {
        fmt.Printf("index %d: rune %c (U+%04X)\n", i, r, r)
    }
    // index 0: rune H (U+0048)
    // index 1: rune e (U+0065)
    // index 2: rune l (U+006C)
    // index 3: rune l (U+006C)
    // index 4: rune o (U+006F)
    // index 5: rune , (U+002C)
    // index 6: rune   (U+0020)
    // index 7: rune 世 (U+4E16)  <- byte index 7 (3 bytes for this rune)
    // index 10: rune 界 (U+754C) <- byte index 10 (3 bytes for this rune)

    fmt.Printf("len in bytes: %d\n", len(s))       // 13 bytes
    fmt.Printf("len in runes: %d\n", len([]rune(s))) // 9 runes
}
```

### Example 5: Unicode Code Point Conversions

```go
package main

import "fmt"

func main() {
    // rune to string: UTF-8 encoding of the code point
    fmt.Println(string(rune(65)))      // "A"
    fmt.Println(string(rune(0x4e16)))  // "世"
    fmt.Println(string(rune(0x1F600))) // "😀" (emoji, requires 4 UTF-8 bytes)

    // Invalid code point → replacement character
    fmt.Println(string(rune(-1)))      // "\uFFFD" = "▿"
    fmt.Println(string(rune(0x110000))) // invalid, "\uFFFD"

    // Converting []rune to string
    runes := []rune{'H', 'e', 'l', 'l', 'o'}
    fmt.Println(string(runes)) // "Hello"
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Rune literals | https://go.dev/ref/spec#Rune_literals | Core rune syntax and escape sequences |
| Numeric types | https://go.dev/ref/spec#Numeric_types | `rune` as alias for `int32` |
| Source code representation | https://go.dev/ref/spec#Source_code_representation | Go source is UTF-8 |
| String types | https://go.dev/ref/spec#String_types | String as byte sequence |
| String literals | https://go.dev/ref/spec#String_literals | Escape sequences in strings |
| For range | https://go.dev/ref/spec#For_range | `range` over string yields runes |
| Conversions | https://go.dev/ref/spec#Conversions | `string(rune)`, `[]rune(string)` |
| Constants | https://go.dev/ref/spec#Constants | Untyped rune constants |
| unicode/utf8 | https://pkg.go.dev/unicode/utf8 | UTF-8 encoding/decoding |
| unicode | https://pkg.go.dev/unicode | Unicode character classification |
