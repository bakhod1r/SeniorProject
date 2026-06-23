# Raw String Literals — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §String_literals (raw string literals section)

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

### Raw String Literals (from Go Language Specification)

> Raw string literals are character sequences between back quotes, as in `` `foo` ``. Within the quotes, any character may appear except back quote. The value of a raw string literal is the string composed of the uninterpreted (implicitly UTF-8-encoded) characters between the quotes; in particular, **backslashes have no special meaning** and the string **may contain newlines**. Carriage return characters (`'\r'`) inside raw string literals are **discarded** from the raw string value.

From the complete string literal section:

> A string literal represents a string constant obtained from concatenating a sequence of characters. There are two forms: raw string literals and interpreted string literals.

---

## 2. Formal Grammar

From the Go specification:

```ebnf
string_lit     = raw_string_lit | interpreted_string_lit .
raw_string_lit = "`" { unicode_char | newline } "`" .
```

Where:
```ebnf
unicode_char   = /* an arbitrary Unicode code point except newline */ .
newline        = /* the Unicode code point U+000A */ .
```

Key observations:
- The delimiter is the **back quote** (`` ` ``), also called backtick (U+0060)
- Content can be any Unicode character **or** newline
- Content **cannot** contain a back quote character
- All characters including backslash are treated literally

---

## 3. Core Rules

### Rule 1: Back-Quote Delimited
A raw string literal begins and ends with the back-quote character (`` ` ``). The back-quote character **cannot appear** inside a raw string literal.

```go
s := `Hello, World`   // valid
// s := `can't use ` here`  // COMPILE ERROR: contains back quote
```

### Rule 2: Backslashes Are Literal
Unlike interpreted string literals, **backslashes have no special meaning** in raw string literals:

```go
s := `C:\Users\name\Desktop`   // backslashes are literal
fmt.Println(s) // C:\Users\name\Desktop
```

Compare with interpreted:
```go
s := "C:\\Users\\name\\Desktop"  // each \\ = one backslash
```

### Rule 3: Newlines Are Literal
Raw string literals can span multiple lines. Newline characters in the source become newline characters in the string value:

```go
s := `line one
line two
line three`
```

The value of `s` contains actual newline bytes (`\n`, U+000A).

### Rule 4: Carriage Return (`\r`) Is Discarded
The spec explicitly states:
> Carriage return characters (`'\r'`) inside raw string literals are discarded from the raw string value.

On Windows, if the source file uses `\r\n` line endings, the `\r` bytes are stripped from raw string literals. Only `\n` remains.

### Rule 5: No Escape Processing
No escape sequences are recognized in raw string literals. `\n`, `\t`, `\u`, etc. are all treated as literal backslash + letter.

---

## 4. Type Rules

### Type of Raw String Literal
A raw string literal, like all string literals, is an **untyped string constant**. It can be assigned to any string type.

```go
var s string = `hello`
type HTML string
var h HTML = `<b>bold</b>`  // valid: untyped string constant
```

### Zero Value Comparison
An empty raw string literal is equivalent to `""`:
```go
var a = ``      // empty raw string
var b = ""      // empty interpreted string
fmt.Println(a == b)  // true
```

### Identity with Interpreted Literals
Raw and interpreted string literals that represent the same bytes are equal:
```go
raw  := `abc`
interp := "abc"
fmt.Println(raw == interp)  // true

// More complex example from the spec
fmt.Println(`\n` == "\\n")  // true: both are the two-character string \n
```

---

## 5. Behavioral Specification

### Carriage Return Stripping
The spec mandates that `\r` (U+000D) characters are stripped from raw string literals:

| Source file (Windows \r\n) | Resulting string value |
|---------------------------|----------------------|
| `` `line1\r\nline2` `` | `"line1\nline2"` (without \r) |

This ensures consistent behavior between Windows and Unix source files.

### No Unicode Escape Processing
```go
s := `\u4e16`   // the 6-character string: \u4e16
t := "\u4e16"   // the 1-character string: 世 (U+4E16)
fmt.Println(len(s))  // 6
fmt.Println(len(t))  // 3 (UTF-8 bytes for 世)
```

### Multi-Line Raw String
The opening back quote and closing back quote define the string boundary:
```go
s := `first line
second line
third line`
// len(s) includes the newline characters
```

The string starts immediately after the opening `` ` `` and ends immediately before the closing `` ` ``.

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Behavior | Specification Rule |
|----------|-------------------|
| Back quote in content | COMPILE ERROR — not allowed |
| Backslash in content | Treated as literal `\` character |
| Newline in content | Included literally in string value |
| `\r` in source file | Discarded from string value |
| Escape sequences (`\n`, `\t`, etc.) | NOT processed — treated as literal characters |
| Resulting type | Untyped string constant |

### Equivalences Guaranteed by Spec
From the spec's official examples:

```go
`abc`                // same as "abc"
`\n\n`               // same as "\\n\\n"  (two backslash-n sequences)
"\n"                 // NOT the same as `\n`
```

---

## 7. Edge Cases from Spec

### Edge Case 1: Raw String Cannot Contain Backtick
The only character that cannot appear in a raw string literal is the back quote itself. There is no escape mechanism to include it.

```go
// To include a backtick, you must use string concatenation:
s := "`backtick`"       // interpreted string
s = `before ` + "`" + ` after`  // concatenation
```

### Edge Case 2: Indentation Is Part of the String
```go
s := `
    indented
    text
`
// s contains newline + spaces + "indented" + newline + spaces + "text" + newline
```

This is commonly used with `text/template` and `strings.TrimSpace` / `strings.Dedent`.

### Edge Case 3: Raw vs Interpreted Equivalence (from Spec)
The spec provides this exact example:

```go
`\n
\n`
// same as "\\n\n\\n"
```

Analysis:
- `` `\n `` — literal backslash + n
- newline — literal newline
- `\n` — literal backslash + n

Interpreted: `"\\n\n\\n"` = backslash + n + newline + backslash + n

### Edge Case 4: Raw String in Constant Expression
```go
const template = `Hello, {{.Name}}!`
// template is an untyped string constant
const length = len(template)  // compile-time constant: 17
```

### Edge Case 5: Carriage Return Behavior
If a Go source file has `\r\n` line endings (Windows):
```go
s := `line1
line2`
// The \r before each \n is stripped
// s == "line1\nline2"  (no \r)
```

If source file has `\n` only (Unix):
```go
s := `line1
line2`
// s == "line1\nline2"  (same result)
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Raw string literals introduced with back-quote delimiter |
| Go 1.0 | `\r` stripping behavior defined |
| Go 1.0 | Backslash is literal (no escape processing) |

No changes have been made to raw string literal semantics since Go 1.0.

---

## 9. Implementation-Specific Behavior

### Source File Encoding
Go source files are UTF-8 encoded. Raw string literals contain the UTF-8 bytes that appear between the back quotes (minus `\r`). No Unicode normalization is performed.

### Multi-Line Constant
Raw string literals spanning multiple lines are fully valid constant expressions. The compiler handles them at compile time.

### Memory
Raw string literals, like all string constants, may be stored in the read-only data segment of the binary. Identical raw string constants in the same package may share storage (implementation-defined).

### Line Counting
The Go compiler counts lines in source files. A raw string literal spanning multiple lines contributes to the line count, which affects error message line numbers.

---

## 10. Spec Compliance Checklist

- [ ] Raw string literals use back-quote (`` ` ``) as delimiter
- [ ] No escape processing occurs — `\n`, `\t`, etc. are literal characters
- [ ] Backslash has no special meaning
- [ ] Newlines are included literally in the string value
- [ ] `\r` (U+000D) characters are **discarded** from the raw string value
- [ ] Back-quote character **cannot** appear inside a raw string literal
- [ ] Result is an untyped string constant
- [ ] Can be assigned to any string-typed variable
- [ ] Can span multiple source lines
- [ ] Empty raw string literal `` `` `` equals `""`

---

## 11. Official Examples

### Example 1: Official Spec Examples

```go
package main

import "fmt"

func main() {
    // From the Go specification:
    a := `abc`                 // same as "abc"
    b := `\n
\n`                            // same as "\\n\n\\n"
    c := "\n"                  // NOT the same as `\n`
    d := "\""                  // same as `"`
    e := "Hello, world!\n"

    fmt.Printf("%q\n", a)  // "abc"
    fmt.Printf("%q\n", b)  // "\\n\n\\n"
    fmt.Printf("%q\n", c)  // "\n"
    fmt.Printf("%q\n", d)  // "\""
    fmt.Printf("%q\n", e)  // "Hello, world!\n"

    // Verify equivalences
    fmt.Println(a == "abc")         // true
    fmt.Println(b == "\\n\n\\n")   // true
    fmt.Println(`"` == d)           // true
}
```

### Example 2: Backslash Is Literal in Raw Strings

```go
package main

import "fmt"

func main() {
    // Windows path — much cleaner in raw string literal
    winPath := `C:\Users\Alice\Documents\file.txt`
    fmt.Println(winPath)
    // C:\Users\Alice\Documents\file.txt

    // Compare with interpreted string (requires escaping)
    winPathInterp := "C:\\Users\\Alice\\Documents\\file.txt"
    fmt.Println(winPath == winPathInterp) // true

    // Regex pattern — no double-escaping needed
    rawRegex := `^\d{3}-\d{4}$`
    interpRegex := "^\\d{3}-\\d{4}$"
    fmt.Println(rawRegex == interpRegex) // true
    fmt.Println(rawRegex)  // ^\d{3}-\d{4}$
}
```

### Example 3: Multi-Line Raw String

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    // Multi-line string with literal newlines
    poem := `Roses are red,
Violets are blue,
Go is awesome,
And this is true.`

    fmt.Println(poem)
    fmt.Println("Lines:", strings.Count(poem, "\n")+1) // 4 lines

    // JSON template
    jsonTemplate := `{
    "name": "{{.Name}}",
    "age": {{.Age}},
    "email": "{{.Email}}"
}`
    fmt.Println(jsonTemplate)
}
```

### Example 4: Carriage Return Stripping

```go
package main

import "fmt"

func main() {
    // Simulate what happens with \r\n line endings in raw strings
    // (normally handled transparently by the compiler)

    // Interpreted string with \r\n
    withCR := "line1\r\nline2"
    fmt.Printf("with \\r: %q\n", withCR)   // "line1\r\nline2"
    fmt.Println("len with \\r:", len(withCR)) // 13 bytes

    // In a raw string literal, \r is discarded by the compiler
    // The following two are equivalent if source file uses Unix line endings:
    raw := `line1
line2`
    fmt.Printf("raw: %q\n", raw)       // "line1\nline2"
    fmt.Println("len raw:", len(raw))  // 11 bytes

    // Manual \r removal for comparison
    stripped := strings.ReplaceAll(withCR, "\r", "")
    fmt.Println(raw == stripped)  // true
}
```

### Example 5: Raw String for SQL and HTML Templates

```go
package main

import (
    "fmt"
    "text/template"
    "os"
)

const sqlQuery = `
    SELECT u.id, u.name, u.email
    FROM users u
    WHERE u.created_at > '2024-01-01'
      AND u.status = 'active'
    ORDER BY u.name ASC
    LIMIT 100
`

const htmlTemplate = `<!DOCTYPE html>
<html>
<head><title>{{.Title}}</title></head>
<body>
    <h1>{{.Heading}}</h1>
    <p>{{.Content}}</p>
</body>
</html>`

func main() {
    fmt.Println("SQL:", sqlQuery)

    tmpl := template.Must(template.New("page").Parse(htmlTemplate))
    data := struct {
        Title   string
        Heading string
        Content string
    }{"My Page", "Hello", "Welcome to Go!"}
    tmpl.Execute(os.Stdout, data)
}
```

### Example 6: Including Back Quotes (Workaround)

```go
package main

import "fmt"

func main() {
    // A backtick cannot appear inside a raw string literal
    // Workaround: use concatenation
    withBacktick := `before ` + "`" + ` after`
    fmt.Println(withBacktick) // before ` after

    // Or use interpreted string entirely
    withBacktick2 := "before ` after"
    fmt.Println(withBacktick == withBacktick2) // true
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| String literals | https://go.dev/ref/spec#String_literals | Full string literal spec (raw + interpreted) |
| String types | https://go.dev/ref/spec#String_types | String as immutable byte sequence |
| Interpreted string literals | https://go.dev/ref/spec#String_literals | Counterpart with escape processing |
| Source code representation | https://go.dev/ref/spec#Source_code_representation | Go source is UTF-8 |
| Constants | https://go.dev/ref/spec#Constants | String literals are constants |
| Rune literals | https://go.dev/ref/spec#Rune_literals | Escape sequence comparison |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | `string` type |
| text/template | https://pkg.go.dev/text/template | Common use of raw string templates |
| strings | https://pkg.go.dev/strings | String manipulation (TrimSpace, etc.) |
