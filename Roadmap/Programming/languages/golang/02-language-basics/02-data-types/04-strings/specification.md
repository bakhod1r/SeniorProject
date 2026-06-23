# Strings — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §String_types

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

### String Types (from Go Language Specification)

> A string type represents the set of string values. A string value is a (possibly empty) sequence of bytes. The number of bytes is called the **length** of the string and is never negative. Strings are **immutable**: once created, it is impossible to change the contents of a string. The predeclared string type is `string`; it is a defined type.
>
> The length of a string `s` can be discovered using the built-in function `len`. The length is a compile-time constant if the string is a constant. A string's bytes can be accessed by integer indices `0` through `len(s)-1`. It is illegal to take the address of such an element; if `s[i]` is the i'th byte of a string, `&s[i]` is invalid.

### String Comparison (from Go Language Specification — Comparison Operators)

> String types are comparable and ordered. Two string values are compared **lexically byte-wise**.

### String Operations (from Go Language Specification — Arithmetic Operators)

> Strings can be concatenated using the `+` operator or the `+=` assignment operator:
>
> ```
> s := "hi" + string(c)
> s += " and good bye"
> ```

### String Conversion Rules (from Go Language Specification — Conversions)

> Converting a value of a string type to a slice of bytes type yields a non-nil slice whose successive elements are the bytes of the string.
>
> Converting a value of a string type to a slice of runes type yields a slice containing the individual Unicode code points of the string.

---

## 2. Formal Grammar

From the Go specification, string literal EBNF:

```ebnf
string_lit             = raw_string_lit | interpreted_string_lit .
raw_string_lit         = "`" { unicode_char | newline } "`" .
interpreted_string_lit = `"` { unicode_value | byte_value } `"` .
```

Where:
```ebnf
unicode_value    = unicode_char | little_u_value | big_u_value | escaped_char .
byte_value       = octal_byte_value | hex_byte_value .
```

---

## 3. Core Rules

### Rule 1: String is a Sequence of Bytes
> A string value is a (possibly empty) sequence of bytes.

Strings in Go are byte sequences. They are **not** sequences of Unicode characters. A single Unicode character may be represented by 1 to 4 bytes in UTF-8.

### Rule 2: Strings Are Immutable
> Strings are immutable: once created, it is impossible to change the contents of a string.

You cannot modify individual bytes of a string. Any operation that appears to modify a string actually creates a new string.

### Rule 3: len() Returns Bytes, Not Runes
`len(s)` returns the **number of bytes** in the string, not the number of Unicode characters (runes).

```go
s := "Hello"  // 5 bytes, 5 runes
fmt.Println(len(s)) // 5

t := "世界"    // 6 bytes, 2 runes
fmt.Println(len(t)) // 6
```

### Rule 4: Indexing Returns Bytes
`s[i]` returns the `i`-th **byte** of the string as type `uint8` (which is `byte`):

```go
s := "Hello"
b := s[0]   // b is byte('H') = 72
fmt.Printf("%T %d\n", b, b) // uint8 72
```

### Rule 5: Cannot Take Address of String Element
> It is illegal to take the address of such an element; if `s[i]` is the i'th byte of a string, `&s[i]` is invalid.

### Rule 6: nil String vs Empty String
Unlike slices, strings cannot be `nil`. The zero value of a string is `""` (empty string, 0 bytes).

---

## 4. Type Rules

### string is a Defined Type
`string` is a predeclared **defined type**. This means:
- It has an underlying type of `string`
- Named string types are distinct: `type MyString string`
- `MyString` and `string` are not the same type

### Zero Value
The zero value for any string type is `""` (empty string, not nil).

### String Operations

| Operation | Description | Returns |
|-----------|-------------|---------|
| `len(s)` | Number of bytes | `int` |
| `s[i]` | i-th byte | `byte` (`uint8`) |
| `s + t` | Concatenation | `string` |
| `s += t` | Append | — |
| `s == t` | Equality | `bool` |
| `s != t` | Inequality | `bool` |
| `s < t` | Lexicographic less | `bool` |
| `s[i:j]` | Slice (sub-string) | `string` |
| `s[i:]` | Slice from i | `string` |
| `s[:j]` | Slice to j | `string` |

### Type Conversions Involving Strings

| Conversion | Result | Notes |
|------------|--------|-------|
| `string(r)` where r is rune/int | UTF-8 encoding of code point | Spec-defined |
| `string(b)` where b is []byte | String with same bytes | Spec-defined |
| `[]byte(s)` | Byte slice copy | Non-nil |
| `[]rune(s)` | Rune (Unicode) slice | UTF-8 decoded |
| `string(n)` where n is integer constant | DEPRECATED style | Use `string(rune(n))` |

---

## 5. Behavioral Specification

### UTF-8 Encoding
Go source code is UTF-8. String literals are UTF-8 encoded. However, the spec does **not** require string values to contain valid UTF-8. A string is just a byte sequence, and any byte sequence is valid.

### String Comparison: Lexicographic Byte-Wise
From the spec:
> Two string values are compared lexically byte-wise.

This means comparison is done byte by byte from left to right. The first differing byte determines the order. Length is compared only when all leading bytes are equal.

```go
"abc" < "abd"    // true (third byte 'c' < 'd')
"ab" < "abc"     // true ("ab" is a prefix of "abc")
"abc" == "abc"   // true
```

### range Over String: Decodes UTF-8
The `range` keyword over a string decodes UTF-8 and yields `(int, rune)` pairs:
- First value: byte index of the rune
- Second value: the rune (Unicode code point)

Invalid UTF-8 bytes yield `RuneError` (U+FFFD) and advance 1 byte.

### String Slicing
`s[i:j]` produces a string sharing the underlying bytes with `s`. No copying occurs. The indices `i` and `j` are **byte** indices.

```go
s := "Hello, World"
sub := s[0:5]   // "Hello" (bytes 0 through 4)
```

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Behavior | Guarantee |
|----------|-----------|
| `len(s)` | Returns byte count, never negative |
| `s[i]` | Returns byte at position i |
| `&s[i]` | Compile error — cannot take address |
| Zero value | `""` (empty string, zero bytes) |
| `string` can be `nil` | No — zero value is `""`, not nil |
| `s1 + s2` | Concatenation: all bytes of s1 followed by all bytes of s2 |
| Lexicographic comparison | Byte-wise, left to right |
| `[]byte(s)` | Returns copy of string bytes |
| `[]rune(s)` | Returns UTF-8 decoded code points |
| Invalid UTF-8 in `range` | Yields U+FFFD, advances 1 byte |

### Implementation-Dependent

| Behavior | Notes |
|----------|-------|
| Internal string representation | Pointer + length (not specified by lang spec) |
| Whether `s[i:j]` copies bytes | Implementation may share or copy |

---

## 7. Edge Cases from Spec

### Edge Case 1: Empty String vs nil
Strings cannot be nil:
```go
var s string
fmt.Println(s == "")    // true (zero value is "")
fmt.Println(s == nil)   // COMPILE ERROR: cannot compare string to untyped nil
```

### Edge Case 2: len() on Constant String
From the spec:
> The length is a compile-time constant if the string is a constant.

```go
const s = "hello"
const n = len(s)  // n is a constant: 5
```

### Edge Case 3: Indexing Returns Bytes Not Runes
```go
s := "世界"
fmt.Println(len(s))   // 6 (bytes)
fmt.Println(s[0])     // 228 = 0xE4 (first byte of UTF-8 for '世')
// NOT the rune '世'
```

### Edge Case 4: String Slicing Must Align to UTF-8 Boundaries
Slicing at non-UTF-8 boundaries is valid (no panic), but the result may contain invalid UTF-8:
```go
s := "世界"
t := s[0:2]  // valid syntax, but t contains only first 2 of 3 bytes of '世'
// t is NOT valid UTF-8
```

### Edge Case 5: Named String Type
```go
type HTML string
var h HTML = "<b>bold</b>"
var s string = string(h)  // explicit conversion required
```

### Edge Case 6: String Comparison With Different Lengths
```go
"a" < "aa"    // true: "a" is shorter and a prefix
"aa" < "b"    // true: first byte 'a' (97) < 'b' (98)
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `string` type as immutable byte sequence |
| Go 1.0 | `range` over string yields (int, rune) pairs |
| Go 1.0 | `len(s)` returns byte count |
| Go 1.10 | `strings.Builder` added for efficient string construction |
| Go 1.20 | `unsafe.String` and `unsafe.StringData` added for low-level ops |

---

## 9. Implementation-Specific Behavior

### Internal Representation (gc compiler)
A string value is internally represented as a struct:
```
struct {
    ptr *byte  // pointer to first byte
    len int    // number of bytes
}
```

Size: `unsafe.Sizeof("")` == 16 bytes (on 64-bit: 8 byte pointer + 8 byte int).

### String Sharing
String slicing (`s[i:j]`) shares the underlying byte array with the original string. No copying occurs. Because strings are immutable, this sharing is safe.

### String Interning
The gc compiler may intern string constants (share the same memory for equal string constants). This is an implementation detail not guaranteed by the spec.

### Garbage Collection
Strings are garbage collected. When no more references exist to a string's underlying bytes, the memory is reclaimed.

---

## 10. Spec Compliance Checklist

- [ ] `string` is an immutable byte sequence
- [ ] `len(s)` returns byte count, not rune count
- [ ] `s[i]` returns `byte` (uint8), not `rune`
- [ ] `&s[i]` is a compile error
- [ ] Zero value is `""` (not nil)
- [ ] Strings cannot be nil
- [ ] String comparison is lexicographic and byte-wise
- [ ] `range` over string yields (byte_index, rune) pairs
- [ ] Invalid UTF-8 in range yields U+FFFD + advance 1 byte
- [ ] `[]byte(s)` returns a copy (non-nil)
- [ ] `[]rune(s)` returns UTF-8 decoded code points
- [ ] `string(r)` where r is integer yields UTF-8 encoding of code point
- [ ] String concatenation with `+` produces a new string
- [ ] Named string types (`type HTML string`) are distinct from `string`

---

## 11. Official Examples

### Example 1: String Basics

```go
package main

import "fmt"

func main() {
    // String is a sequence of bytes
    s := "Hello, 世界"

    // len() returns bytes, not runes
    fmt.Println("bytes:", len(s))          // 13 (7 ASCII + 3+3 for two Chinese chars)
    fmt.Println("runes:", len([]rune(s)))  // 9

    // Indexing returns bytes (uint8)
    b := s[0]
    fmt.Printf("s[0] = %d (%T) = %q\n", b, b, b) // 72 (uint8) = 'H'

    // Strings are immutable
    // s[0] = 'h'  // COMPILE ERROR: cannot assign to s[0]

    // Zero value
    var empty string
    fmt.Println(empty == "")    // true
    fmt.Println(len(empty))     // 0
}
```

### Example 2: Byte Indexing vs Rune Iteration

```go
package main

import "fmt"

func main() {
    s := "Go: 世界"

    fmt.Println("--- Byte indexing ---")
    for i := 0; i < len(s); i++ {
        fmt.Printf("s[%d] = 0x%02X\n", i, s[i])
    }

    fmt.Println("--- Rune iteration (range) ---")
    for i, r := range s {
        fmt.Printf("index %d: rune %c (U+%04X)\n", i, r, r)
    }
    // Notice: byte indices jump for multi-byte runes
    // index 4: rune 世 (U+4E16) -- starts at byte 4
    // index 7: rune 界 (U+754C) -- starts at byte 7 (3 bytes later)
}
```

### Example 3: String Comparison (Lexicographic Byte-Wise)

```go
package main

import "fmt"

func main() {
    words := []string{"banana", "apple", "cherry", "apple", "Banana"}

    // Lexicographic: byte-wise
    fmt.Println("banana" < "cherry")  // true  (b < c)
    fmt.Println("apple" < "banana")   // true  (a < b)
    fmt.Println("Banana" < "banana")  // true  (B=66 < b=98)

    // Sort by lexicographic order
    for i := 0; i < len(words)-1; i++ {
        for j := i + 1; j < len(words); j++ {
            if words[i] > words[j] {
                words[i], words[j] = words[j], words[i]
            }
        }
    }
    fmt.Println(words) // [Banana apple apple banana cherry]
}
```

### Example 4: Type Conversions

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"

    // string → []byte
    bytes := []byte(s)
    fmt.Printf("[]byte: %v\n", bytes)
    bytes[0] = 'h'    // modifying the copy is fine
    fmt.Println(s)    // original unchanged: "Hello, 世界"

    // string → []rune
    runes := []rune(s)
    fmt.Printf("[]rune: %v\n", runes)
    fmt.Println("rune count:", len(runes)) // 9

    // []byte → string
    b := []byte{72, 101, 108, 108, 111}
    fmt.Println(string(b)) // "Hello"

    // []rune → string
    r := []rune{72, 101, 108, 108, 111}
    fmt.Println(string(r)) // "Hello"

    // rune → string (UTF-8 encode single code point)
    fmt.Println(string(rune(0x4e16))) // "世"
}
```

### Example 5: String Immutability and Concatenation

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    // + creates new strings
    a := "Hello"
    b := a + ", World"
    fmt.Println(a) // "Hello" (unchanged)
    fmt.Println(b) // "Hello, World"

    // += is equivalent to a = a + ...
    a += "!"
    fmt.Println(a) // "Hello!"

    // Efficient multi-part construction: use strings.Builder
    var sb strings.Builder
    for i := 0; i < 5; i++ {
        fmt.Fprintf(&sb, "item%d ", i)
    }
    result := sb.String()
    fmt.Println(result) // "item0 item1 item2 item3 item4 "
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| String types | https://go.dev/ref/spec#String_types | Core definition |
| String literals | https://go.dev/ref/spec#String_literals | Raw and interpreted string syntax |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Lexicographic byte comparison |
| Arithmetic operators | https://go.dev/ref/spec#Arithmetic_operators | `+` concatenation |
| Conversions | https://go.dev/ref/spec#Conversions | `string`↔`[]byte`↔`[]rune` |
| For range | https://go.dev/ref/spec#For_range | Range over string |
| Index expressions | https://go.dev/ref/spec#Index_expressions | `s[i]` byte access |
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | `s[i:j]` substring |
| Built-in functions | https://go.dev/ref/spec#Built-in_functions | `len(s)` |
| unicode/utf8 | https://pkg.go.dev/unicode/utf8 | UTF-8 utilities |
| strings | https://pkg.go.dev/strings | String manipulation |
