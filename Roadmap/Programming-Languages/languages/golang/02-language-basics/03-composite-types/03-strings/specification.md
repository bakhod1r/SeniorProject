# Go Specification: Strings

**Source:** https://go.dev/ref/spec#String_types
**Section:** Types → String types

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#String_types
- **Related:** https://go.dev/ref/spec#Index_expressions
- **Related:** https://go.dev/ref/spec#Slice_expressions
- **Related:** https://go.dev/ref/spec#Conversions
- **Related:** https://go.dev/ref/spec#For_range
- **Related:** https://go.dev/ref/spec#String_concatenation

Official definition from the spec:

> "A string type represents the set of string values. A string value is a (possibly empty) sequence of bytes. The number of bytes is called the length of the string and is never negative. Strings are immutable: once created, it is impossible to change the contents of a string. The predeclared string type is `string`; it is a defined type."

---

## 2. Formal Grammar (EBNF)

```ebnf
StringType  = "string" .

string_lit             = raw_string_lit | interpreted_string_lit .
raw_string_lit         = "`" { unicode_char | newline } "`" .
interpreted_string_lit = `"` { unicode_value | byte_value } `"` .
```

- A raw string literal (backticks) contains uninterpreted bytes; no escape sequences, backslashes are literal, carriage returns are discarded.
- An interpreted string literal (double quotes) processes escape sequences (`\n`, `\t`, `\xFF`, `é`, etc.).

```go
raw := `C:\temp\new`          // backslashes are literal
interp := "line1\nline2"      // \n is a newline
```

---

## 3. Core Rules & Constraints

### 3.1 Strings Are Byte Sequences, Not Character Sequences

`len(s)` returns the number of **bytes**, not the number of characters (runes).

```go
package main

import "fmt"

func main() {
    s := "Hello, 世界"
    fmt.Println(len(s)) // 13 — '世' and '界' are 3 bytes each in UTF-8
}
```

### 3.2 Immutability

A string's bytes cannot be modified after creation. Indexing yields a value, not an addressable location.

```go
package main

func main() {
    s := "hello"
    // s[0] = 'H' // compile error: cannot assign to s[0] (value of type byte)
    _ = s
}
```

### 3.3 Indexing Yields a byte

`s[i]` is the byte (type `byte` = `uint8`) at index `i`, with `0 <= i < len(s)`.

```go
package main

import "fmt"

func main() {
    s := "ABC"
    fmt.Printf("%d %c\n", s[0], s[0]) // 65 A
}
```

### 3.4 String Concatenation

The `+` operator concatenates strings. `+=` is also defined.

```go
package main

import "fmt"

func main() {
    a := "go"
    b := "lang"
    fmt.Println(a + b) // golang
}
```

### 3.5 Comparison

Strings are comparable and ordered. `==`, `!=`, `<`, `<=`, `>`, `>=` compare lexically byte-by-byte.

```go
package main

import "fmt"

func main() {
    fmt.Println("abc" < "abd") // true
    fmt.Println("Z" < "a")     // true — 'Z'=90, 'a'=97
}
```

---

## 4. Type Rules

### 4.1 `string` Is a Defined Type

`string` is predeclared and a defined type. A named type with underlying type `string` (e.g., `type Name string`) is a distinct type but shares string behavior.

### 4.2 Conversions: string ↔ []byte and string ↔ []rune

- `[]byte(s)` produces a copy of the string's bytes.
- `string(b)` where `b` is `[]byte` produces a string from the bytes.
- `[]rune(s)` decodes UTF-8 into code points.
- `string(r)` where `r` is `[]rune` encodes code points to UTF-8.

```go
package main

import "fmt"

func main() {
    s := "héllo"
    b := []byte(s)
    r := []rune(s)
    fmt.Println(len(s), len(b), len(r)) // 6 6 5
}
```

### 4.3 Integer to string Conversion

`string(i)` where `i` is an integer yields the UTF-8 representation of the Unicode code point — NOT the decimal digits. (`go vet` flags this.)

```go
package main

import "fmt"

func main() {
    fmt.Println(string(rune(65))) // "A", not "65"
    // Use strconv.Itoa for "65"
}
```

### 4.4 Assignability and Constants

Untyped string constants are assignable to any string type. The default type of a string constant is `string`.

---

## 5. Behavioral Specification

### 5.1 `range` Over a String Decodes Runes

A `for range` loop over a string iterates over Unicode code points (runes), yielding the **byte index** and the rune value.

```go
package main

import "fmt"

func main() {
    for i, r := range "a世b" {
        fmt.Printf("index=%d rune=%c (%d)\n", i, r, r)
    }
    // index=0 rune=a (97)
    // index=1 rune=世 (19990)
    // index=4 rune=b (98)
}
```

### 5.2 Slicing a String

`s[low:high]` produces a string sharing the same backing bytes (no copy). Bounds are byte indices.

```go
package main

import "fmt"

func main() {
    s := "hello world"
    fmt.Println(s[6:]) // world
}
```

### 5.3 Invalid UTF-8 Handling in range

When `range` encounters invalid UTF-8, it yields `utf8.RuneError` (U+FFFD) and advances one byte.

### 5.4 Zero Value

The zero value of a string is the empty string `""`, with `len == 0`. There is no nil string.

```go
package main

import "fmt"

func main() {
    var s string
    fmt.Printf("%q %d\n", s, len(s)) // "" 0
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Index Out of Range Panics

```go
package main

func main() {
    s := "abc"
    _ = s[5] // panic: runtime error: index out of range [5] with length 3
}
```

For constant strings with a constant index, an out-of-range index is a **compile-time** error.

### 6.2 Defined: Slicing Bounds

`s[low:high]` requires `0 <= low <= high <= len(s)`; otherwise a runtime panic occurs.

### 6.3 Defined: Conversion Always Copies

`[]byte(s)` and `string(b)` always copy; the compiler may optimize specific patterns (e.g., `string(b)` used only as a map key) but the language semantics guarantee independence.

### 6.4 Defined: Concatenation of Empty Strings

`"" + s == s`. Concatenation never produces invalid state.

---

## 7. Edge Cases from Spec

### 7.1 Empty String vs Whitespace

`""` has length 0; `" "` has length 1. There is no nil string distinct from empty.

### 7.2 Byte Index May Land Mid-Rune

Indexing or slicing at an arbitrary byte position can split a multi-byte rune, producing invalid UTF-8.

```go
package main

import "fmt"

func main() {
    s := "世界"
    fmt.Println(s[0:1]) // a single byte of '世' — invalid UTF-8 fragment
    fmt.Printf("%q\n", s[0:1])
}
```

### 7.3 Raw String Literals Cannot Contain Backticks

There is no escape for a backtick inside a raw string literal; concatenation is required.

### 7.4 Carriage Returns in Raw Strings

`\r` characters inside raw string literals are discarded from the value.

### 7.5 Comparing Named String Types

A `type ID string` value is not directly comparable to a `string` value without conversion, but untyped constants compare freely.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | String type, immutability, range-over-rune semantics established |
| Go 1.0 | `string([]rune)` and `string([]byte)` conversions specified |
| Go 1.15 | `go vet` warns on `string(int)` conversion (later requires `rune`) |
| Go 1.18 | `string(int)` without `rune` flagged more strictly |
| Go 1.21 | No spec change; `strings` and `unicode/utf8` continue to back string handling |

---

## 9. Implementation-Specific Behavior

### 9.1 String Header Layout (gc Compiler)

A string is a two-word descriptor:

```
type StringHeader struct {
    Data uintptr // pointer to backing bytes
    Len  int     // byte length
}
```

Exposed via `reflect.StringHeader` (deprecated Go 1.20 in favor of `unsafe.String` / `unsafe.StringData`).

### 9.2 String Interning of Constants

The gc compiler may store identical string constants once in the read-only data segment; backing bytes for constants live in read-only memory, which is why mutation is impossible.

### 9.3 Copy Elision

`string(b)` followed by use as a map key, or `[]byte(s)` in a `range`, can be optimized to avoid the copy when the compiler proves the bytes are not mutated.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"key": 1}
    b := []byte("key")
    fmt.Println(m[string(b)]) // copy may be elided
}
```

---

## 10. Spec Compliance Checklist

- [ ] `len(s)` counts bytes, not characters
- [ ] Strings are immutable; `s[i] = x` is a compile error
- [ ] `s[i]` yields a `byte` value (not addressable)
- [ ] `range` over a string yields `(byteIndex, rune)` pairs
- [ ] Slicing `s[low:high]` shares backing bytes, no copy
- [ ] Conversions `[]byte(s)`, `[]rune(s)`, `string(b)`, `string(r)` copy data
- [ ] `string(int)` yields a code point, not decimal digits (use `strconv`)
- [ ] Zero value is `""`; there is no nil string
- [ ] Strings are comparable and ordered (lexical byte comparison)
- [ ] Raw string literals do not process escapes; `\r` is discarded
- [ ] Out-of-range index panics at runtime (compile error for constant index)

---

## 11. Official Examples

### Example 1: Bytes vs Runes

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    s := "Hello, 世界"
    fmt.Println("bytes:", len(s))                 // 13
    fmt.Println("runes:", utf8.RuneCountInString(s)) // 9
}
```

### Example 2: Building Strings Efficiently

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    var b strings.Builder
    for i := 0; i < 3; i++ {
        b.WriteString("go")
    }
    fmt.Println(b.String()) // gogogo
}
```

### Example 3: Iterating Runes with Indexes

```go
package main

import "fmt"

func main() {
    for i, r := range "café" {
        fmt.Printf("%d:%c ", i, r)
    }
    fmt.Println() // 0:c 1:a 2:f 3:é
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| String types | https://go.dev/ref/spec#String_types | Core definition and immutability |
| Index expressions | https://go.dev/ref/spec#Index_expressions | `s[i]` yields a byte |
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | `s[low:high]` substring semantics |
| Conversions | https://go.dev/ref/spec#Conversions | string ↔ []byte ↔ []rune ↔ int |
| For range | https://go.dev/ref/spec#For_range | Rune-by-rune iteration |
| String concatenation | https://go.dev/ref/spec#String_concatenation | `+` operator |
| Constants | https://go.dev/ref/spec#Constants | Untyped string constants |
| Package unsafe | https://go.dev/ref/spec#Package_unsafe | `unsafe.String`, `unsafe.StringData` |
