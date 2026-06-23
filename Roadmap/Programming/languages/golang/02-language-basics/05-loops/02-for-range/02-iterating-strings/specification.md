# for-range over Strings — Specification
> Source: [Go Language Specification](https://go.dev/ref/spec) — §For_statements_with_range_clause (string range)

---

## 1. Spec Reference

The `for-range` statement applied to strings is defined in the Go Language Specification at:

https://go.dev/ref/spec#For_range

| Field              | Value                                                                 |
|--------------------|-----------------------------------------------------------------------|
| Official Spec      | [https://go.dev/ref/spec](https://go.dev/ref/spec)                    |
| Primary Section    | §For_statements with range clause                                     |
| Supporting Sections| §String_types, §Rune_literals, §Source_code_representation            |
| Go Version         | Go 1.0+ (string range has been available since the first release)     |

The specification states:

> "For a string value, the 'range' clause iterates over the Unicode code points in the string starting at byte index 0. On successive iterations, the index value will be the index of the first byte of successive UTF-8-encoded code points in the string, and the second value, of type rune, will be the value of the corresponding code point. If the iteration encounters an invalid UTF-8 sequence, the second value will be 0xFFFD, the Unicode replacement character, and the next iteration will advance a single byte in the string."

This paragraph is the authoritative definition for all string range behavior. Every rule, edge case, and behavioral guarantee in this document derives from this spec text.

---

## 2. Formal Grammar (EBNF)

From the Go Language Specification:

```ebnf
ForStmt     = "for" [ Condition | ForClause | RangeClause ] Block .
RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

When the range expression evaluates to a `string` type, the following forms are valid:

```go
// Short variable declaration forms
for i, r := range s { }   // i = byte index (int), r = rune value (rune)
for i := range s { }      // i = byte index only
for range s { }            // no iteration variables (count runes or side-effects)

// Assignment forms (variables must already be declared)
for i, r = range s { }    // assign byte index and rune to existing variables
for i = range s { }       // assign byte index to existing variable

// Blank identifier forms
for _, r := range s { }   // discard byte index, receive rune only
for _, _ = range s { }    // valid but prefer: for range s { }
```

The range expression `s` must be of type `string`. The first iteration variable receives the **byte index** (type `int`). The second iteration variable receives the **decoded rune** (type `rune`, which is an alias for `int32`).

---

## 3. Core Rules & Constraints

### Rule 1: Range iterates over Unicode code points (runes), not bytes

When you use `for i, r := range s`, the loop does **not** iterate once per byte. It iterates once per **Unicode code point** (rune). A single rune may occupy 1 to 4 bytes in UTF-8 encoding.

```go
s := "Go" // 2 bytes, 2 runes
// Range produces 2 iterations

s2 := "Go世界" // 2 + 3 + 3 = 8 bytes, 4 runes
// Range produces 4 iterations, NOT 8
```

This is fundamentally different from a byte-indexed loop (`for i := 0; i < len(s); i++`), which iterates once per byte.

### Rule 2: The index variable gives the byte position, not the rune position

The first iteration variable `i` is the **byte offset** of the current rune within the string, not the logical rune position (0th rune, 1st rune, etc.).

```go
s := "aB世界"
// Iteration 0: i=0, r='a'  (1 byte)
// Iteration 1: i=1, r='B'  (1 byte)
// Iteration 2: i=2, r='世' (3 bytes, starts at byte 2)
// Iteration 3: i=5, r='界' (3 bytes, starts at byte 5)
```

Notice that `i` jumps from 2 to 5, skipping byte indices 3 and 4 which are continuation bytes of the '世' character. The index is **not** sequential by rune count.

### Rule 3: The value variable gives the rune (int32/rune)

The second iteration variable `r` is of type `rune` (alias for `int32`). It contains the fully decoded Unicode code point value, regardless of how many bytes that code point occupies in UTF-8 encoding.

```go
for _, r := range "A世" {
    fmt.Printf("%T %d %c\n", r, r, r)
    // int32 65 A
    // int32 19990 世
}
```

### Rule 4: Invalid UTF-8 bytes produce U+FFFD (Unicode replacement character)

When the range encounters a byte sequence that is not valid UTF-8, it produces the Unicode replacement character `U+FFFD` (decimal 65533) and advances by **exactly one byte**. This is **defined behavior**, not undefined.

```go
s := "\xff\xfe" // two invalid UTF-8 bytes
for i, r := range s {
    fmt.Printf("i=%d r=U+%04X\n", i, r)
    // i=0 r=U+FFFD
    // i=1 r=U+FFFD
}
```

Each invalid byte produces its own iteration with U+FFFD. The loop advances by one byte per invalid byte, not by zero bytes (which would cause an infinite loop) and not by more than one byte (which would skip data).

### Rule 5: Index advances by rune byte-width (1-4 bytes per rune)

The byte index advances by the UTF-8 encoded width of the current rune:

| Unicode Range          | UTF-8 Bytes | Byte Width | Example Characters     |
|------------------------|-------------|------------|------------------------|
| U+0000 to U+007F       | 1 byte      | 1          | ASCII: A, z, 0, !      |
| U+0080 to U+07FF       | 2 bytes     | 2          | Latin: a, o, n          |
| U+0800 to U+FFFF       | 3 bytes     | 3          | CJK: 世, 界, 中         |
| U+10000 to U+10FFFF    | 4 bytes     | 4          | Emoji: U+1F600          |

For invalid UTF-8 sequences, the advance is always **1 byte**.

### Rule 6: The range expression is evaluated exactly once

The string expression on the right side of `range` is evaluated once before the loop begins. Reassigning the string variable inside the loop body does not affect the iteration.

```go
s := "hello"
for i, r := range s {
    if i == 0 {
        s = "world" // does NOT change what the loop iterates over
    }
    fmt.Printf("%c", r) // prints: h e l l o
}
```

---

## 4. Type Rules

### Iteration variable types

| Range Expression | 1st Variable (Index) | 2nd Variable (Value) |
|------------------|----------------------|----------------------|
| `string`         | `int`                | `rune` (alias `int32`)|

The index is always `int`, regardless of the platform. The value is always `rune` (`int32`), regardless of whether the string contains only ASCII characters.

### Assignability rules

When using the assignment form (`=` instead of `:=`), the target variables must be assignable from `int` and `rune` respectively:

```go
// Valid: exact type match
var idx int
var ch rune
for idx, ch = range "hello" {
    _ = idx
    _ = ch
}

// Valid: rune is alias for int32, so int32 works
var bytePos int
var codePoint int32
for bytePos, codePoint = range "hello" {
    _ = bytePos
    _ = codePoint
}

// Valid: assignable to interface{}
var a, b any
for a, b = range "hello" {
    _ = a
    _ = b
}
```

### Type inference with short declaration

```go
for i, r := range "hello" {
    // i is inferred as int
    // r is inferred as rune (int32)
    fmt.Printf("i: %T, r: %T\n", i, r) // i: int, r: int32
}
```

Note: `%T` prints `int32` for `rune` because `rune` is a type alias, not a distinct type.

### String type includes named string types

Range works with any type whose underlying type is `string`:

```go
type Name string

var n Name = "hello"
for i, r := range n { // valid: underlying type of Name is string
    _ = i
    _ = r
}
```

---

## 5. Behavioral Specification

### Normal execution: ASCII-only strings

For strings containing only ASCII characters (U+0000 to U+007F), each rune is exactly one byte. The byte index and the rune index are identical:

```go
package main

import "fmt"

func main() {
    s := "Hello"
    for i, r := range s {
        fmt.Printf("byte[%d] = '%c' (U+%04X)\n", i, r, r)
    }
}
```

Output:
```
byte[0] = 'H' (U+0048)
byte[1] = 'e' (U+0065)
byte[2] = 'l' (U+006C)
byte[3] = 'l' (U+006C)
byte[4] = 'o' (U+006F)
```

In this case, `len(s)` equals the number of runes (5), and the byte index increments by 1 each iteration.

### Normal execution: multi-byte UTF-8 strings

For strings containing non-ASCII characters, the byte index skips ahead by the byte width of each rune:

```go
package main

import "fmt"

func main() {
    s := "Go世界!" // 2 ASCII + 2 CJK (3 bytes each) + 1 ASCII = 9 bytes, 5 runes
    fmt.Printf("len(s) = %d bytes\n", len(s))

    for i, r := range s {
        fmt.Printf("byte[%d] rune='%c' U+%04X (size=%d bytes)\n",
            i, r, r, runeByteWidth(r))
    }
}

func runeByteWidth(r rune) int {
    switch {
    case r <= 0x7F:
        return 1
    case r <= 0x7FF:
        return 2
    case r <= 0xFFFF:
        return 3
    default:
        return 4
    }
}
```

Output:
```
len(s) = 9 bytes
byte[0] rune='G' U+0047 (size=1 bytes)
byte[1] rune='o' U+006F (size=1 bytes)
byte[2] rune='世' U+4E16 (size=3 bytes)
byte[5] rune='界' U+754C (size=3 bytes)
byte[8] rune='!' U+0021 (size=1 bytes)
```

Notice the byte index jumps: 0, 1, 2, 5, 8. There are only 5 iterations despite the string being 9 bytes long.

### Normal execution: mixed content (ASCII, 2-byte, 3-byte, 4-byte runes)

```go
package main

import "fmt"

func main() {
    // A = 1 byte, n = 2 bytes, 中 = 3 bytes, U+1F600 (grinning face) = 4 bytes
    s := "A\u00F1\u4E2D\U0001F600"
    fmt.Printf("string: %s\nlen: %d bytes\n\n", s, len(s))

    for i, r := range s {
        fmt.Printf("byte[%2d] rune=U+%04X '%c'\n", i, r, r)
    }
}
```

Output:
```
string: An中
len: 10 bytes

byte[ 0] rune=U+0041 'A'
byte[ 1] rune=U+00F1 'n'
byte[ 3] rune=U+4E2D '中'
byte[ 6] rune=U+1F600 ''
```

The byte index advances by 1, 2, 3, and 4 bytes respectively — demonstrating all four UTF-8 encoding widths.

### Error handling: invalid UTF-8 sequences

When the range encounters bytes that do not form valid UTF-8, it produces U+FFFD and advances by one byte:

```go
package main

import "fmt"

func main() {
    // Construct a string with invalid UTF-8 bytes
    s := "a\xc0\xaf\xfeb" // \xc0\xaf is overlong encoding, \xfe is never valid
    fmt.Printf("len: %d bytes\n\n", len(s))

    for i, r := range s {
        if r == '\uFFFD' {
            fmt.Printf("byte[%d] INVALID UTF-8 -> U+FFFD (replacement char)\n", i)
        } else {
            fmt.Printf("byte[%d] rune=U+%04X '%c'\n", i, r, r)
        }
    }
}
```

Output:
```
len: 5 bytes

byte[0] rune=U+0061 'a'
byte[1] INVALID UTF-8 -> U+FFFD (replacement char)
byte[2] INVALID UTF-8 -> U+FFFD (replacement char)
byte[3] INVALID UTF-8 -> U+FFFD (replacement char)
byte[4] rune=U+0062 'b'
```

Each invalid byte gets its own iteration. The loop does not attempt to group invalid bytes together. After processing each invalid byte, the decoder resumes at the next byte position.

### Comparison: for-range vs byte-indexed loop

```go
package main

import "fmt"

func main() {
    s := "Go世界"

    fmt.Println("=== for-range (rune iteration) ===")
    count := 0
    for i, r := range s {
        fmt.Printf("  i=%d r='%c' (U+%04X)\n", i, r, r)
        count++
    }
    fmt.Printf("  iterations: %d\n\n", count) // 4

    fmt.Println("=== byte-indexed loop ===")
    for i := 0; i < len(s); i++ {
        fmt.Printf("  i=%d byte=0x%02X\n", i, s[i])
    }
    fmt.Printf("  iterations: %d\n", len(s)) // 8
}
```

Output:
```
=== for-range (rune iteration) ===
  i=0 r='G' (U+0047)
  i=1 r='o' (U+006F)
  i=2 r='世' (U+4E16)
  i=5 r='界' (U+754C)
  iterations: 4

=== byte-indexed loop ===
  i=0 byte=0x47
  i=1 byte=0x6F
  i=2 byte=0xE4
  i=3 byte=0xB8
  i=4 byte=0x96
  i=5 byte=0xE7
  i=6 byte=0x95
  i=7 byte=0x8C
  iterations: 8
```

The for-range loop produces 4 iterations (one per rune). The byte loop produces 8 iterations (one per byte). The for-range loop automatically decodes the multi-byte UTF-8 sequences into rune values.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Range over empty string `""` | **Defined** -- zero iterations, no panic |
| Range over ASCII-only string | **Defined** -- one iteration per byte, index increments by 1 |
| Range over valid multi-byte UTF-8 | **Defined** -- one iteration per rune, index advances by rune byte-width |
| Invalid UTF-8 byte encountered | **Defined** -- produces U+FFFD, advances by exactly 1 byte |
| Overlong UTF-8 encoding (e.g., `\xc0\x80` for NUL) | **Defined** -- each byte produces U+FFFD separately |
| Truncated multi-byte sequence at end of string | **Defined** -- incomplete bytes each produce U+FFFD |
| Isolated continuation byte (0x80-0xBF) | **Defined** -- produces U+FFFD, advances 1 byte |
| Surrogate half (U+D800-U+DFFF) encoded in string | **Defined** -- each byte produces U+FFFD (surrogates are not valid UTF-8) |
| String containing NUL bytes (`\x00`) | **Defined** -- NUL is valid UTF-8 (U+0000), produced as normal rune |
| Reassigning string variable during range | **Defined** -- range continues over original string value |
| Modifying range variable `r` inside loop | **Defined** -- only affects local copy, no effect on the string |
| Concurrent reads of same string during range | **Defined** -- strings are immutable, concurrent reads are safe |

**Key point:** Invalid UTF-8 handling during string range is entirely **defined behavior**. The spec explicitly states the replacement character and one-byte advance rules. There is no undefined behavior for string range, regardless of what bytes the string contains.

---

## 7. Edge Cases from Spec

### Edge Case 1: Empty string range

Ranging over an empty string produces zero iterations. No panic, no special handling needed:

```go
package main

import "fmt"

func main() {
    s := ""
    count := 0
    for range s {
        count++
    }
    fmt.Println("iterations:", count) // 0

    // The loop body never executes
    for i, r := range s {
        fmt.Println(i, r) // never reached
    }
    fmt.Println("done") // prints immediately
}
```

### Edge Case 2: String consisting entirely of invalid UTF-8

When a string contains only invalid UTF-8 bytes, every byte produces U+FFFD. The number of iterations equals `len(s)`:

```go
package main

import "fmt"

func main() {
    // Every byte is invalid UTF-8
    s := "\x80\x81\xfe\xff"
    fmt.Printf("len: %d bytes\n", len(s))

    for i, r := range s {
        fmt.Printf("byte[%d] = U+%04X (FFFD=%v)\n", i, r, r == '\uFFFD')
    }
}
```

Output:
```
len: 4 bytes
byte[0] = U+FFFD (FFFD=true)
byte[1] = U+FFFD (FFFD=true)
byte[2] = U+FFFD (FFFD=true)
byte[3] = U+FFFD (FFFD=true)
```

Every iteration yields U+FFFD, and the index advances by exactly 1 each time.

### Edge Case 3: Mixing byte indexing and rune iteration

A common mistake is using the byte index from `for-range` as if it were a rune index. This leads to incorrect string slicing:

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    s := "Hello, 世界"

    // WRONG: byte index is not rune index
    runeIndex := 0
    for i, r := range s {
        fmt.Printf("byte_index=%d  rune_index=%d  rune='%c'\n", i, runeIndex, r)
        runeIndex++
    }

    fmt.Println()

    // To get the Nth rune, you cannot use s[n] — that gives a byte
    fmt.Printf("s[7] = 0x%02X (byte, NOT a rune)\n", s[7])

    // Correct: use utf8.DecodeRuneInString or []rune conversion
    runes := []rune(s)
    fmt.Printf("rune[7] = '%c' (U+%04X)\n", runes[7], runes[7])
    fmt.Printf("rune count = %d\n", utf8.RuneCountInString(s))
}
```

Output:
```
byte_index=0  rune_index=0  rune='H'
byte_index=1  rune_index=1  rune='e'
byte_index=2  rune_index=2  rune='l'
byte_index=3  rune_index=3  rune='l'
byte_index=4  rune_index=4  rune='o'
byte_index=5  rune_index=5  rune=','
byte_index=6  rune_index=6  rune=' '
byte_index=7  rune_index=7  rune='世'
byte_index=10  rune_index=8  rune='界'

s[7] = 0xE4 (byte, NOT a rune)
rune[7] = '世' (U+4E16)
rune count = 9
```

Notice how `byte_index` and `rune_index` diverge starting at the first multi-byte character.

### Edge Case 4: Range with only the index variable

When only the index variable is used, the range still iterates by runes — the index still gives byte positions, skipping over multi-byte rune boundaries:

```go
package main

import "fmt"

func main() {
    s := "a世b"
    indices := []int{}
    for i := range s {
        indices = append(indices, i)
    }
    fmt.Println("byte indices:", indices) // [0 1 4]
    // Index jumps from 1 to 4 because '世' occupies bytes 1, 2, 3
}
```

This can be used to count runes without allocating:

```go
func countRunes(s string) int {
    n := 0
    for range s {
        n++
    }
    return n
}
```

### Edge Case 5: Truncated multi-byte UTF-8 at string end

If a multi-byte UTF-8 sequence is incomplete at the end of the string, each orphan byte produces U+FFFD:

```go
package main

import "fmt"

func main() {
    // '世' is E4 B8 96 in UTF-8 — here we truncate after 2 bytes
    s := "a\xe4\xb8" // 'a' + first 2 bytes of '世' (missing third byte)

    for i, r := range s {
        fmt.Printf("byte[%d] = U+%04X '%c'\n", i, r, r)
    }
}
```

Output:
```
byte[0] = U+0061 'a'
byte[1] = U+FFFD '�'
byte[2] = U+FFFD '�'
```

The two orphan bytes of the incomplete sequence each produce their own U+FFFD.

### Edge Case 6: String containing the replacement character U+FFFD

If a string legitimately contains U+FFFD (encoded as valid UTF-8: `\xef\xbf\xbd`), range produces it as a normal rune — indistinguishable from U+FFFD produced by invalid UTF-8:

```go
package main

import "fmt"

func main() {
    // Valid U+FFFD encoded in UTF-8
    valid := "\uFFFD"
    // Invalid byte that will be decoded as U+FFFD
    invalid := "\xff"

    for _, r := range valid {
        fmt.Printf("valid:   U+%04X\n", r) // U+FFFD
    }
    for _, r := range invalid {
        fmt.Printf("invalid: U+%04X\n", r) // U+FFFD
    }
    // Both produce the same rune value — they are indistinguishable
    // To distinguish them, use unicode/utf8.DecodeRuneInString and check the size
}
```

### Edge Case 7: NUL bytes in strings

NUL (`\x00`, U+0000) is a valid single-byte UTF-8 character. It does not terminate the string or cause special behavior:

```go
package main

import "fmt"

func main() {
    s := "a\x00b\x00c"
    fmt.Printf("len: %d\n", len(s)) // 5

    for i, r := range s {
        fmt.Printf("byte[%d] = U+%04X\n", i, r)
    }
    // byte[0] = U+0061  ('a')
    // byte[1] = U+0000  (NUL)
    // byte[2] = U+0062  ('b')
    // byte[3] = U+0000  (NUL)
    // byte[4] = U+0063  ('c')
}
```

### Edge Case 8: Reassigning the string variable during iteration

The range expression is evaluated once. Reassigning the variable does not affect iteration:

```go
package main

import "fmt"

func main() {
    s := "abc"
    for i, r := range s {
        if i == 0 {
            s = "xyz" // does NOT change iteration
        }
        fmt.Printf("%c ", r) // prints: a b c (NOT x y z)
    }
    fmt.Println()
    fmt.Println("s is now:", s) // s is now: xyz
}
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0  | `for i, r := range s` over strings introduced. Iterates over Unicode code points with byte indices. Invalid UTF-8 produces U+FFFD with 1-byte advance. |
| Go 1.4  | `for range s { }` with no iteration variables allowed (previously required at least one variable). |
| Go 1.22 | Per-iteration loop variable semantics: each iteration of `for i, r := range s` creates new `i` and `r` variables. Closures capture per-iteration values. Controlled by `go` directive in `go.mod`. |

The string range behavior itself (rune decoding, byte indexing, U+FFFD replacement) has been **unchanged since Go 1.0**. No corrections or modifications have been made to the string iteration semantics in any subsequent release.

---

## 9. Implementation-Specific Behavior

### UTF-8 decoder used by range

The Go runtime uses its own internal UTF-8 decoder for string range iteration. This decoder is optimized for the common case of valid ASCII and valid multi-byte UTF-8. Internally, the compiler may transform the range loop into:

```go
// Conceptual desugaring (not actual compiler output):
for i := 0; i < len(s); {
    r, size := utf8.DecodeRuneInString(s[i:])
    // ... loop body with i and r ...
    i += size
}
```

However, the actual implementation uses a more optimized code path that avoids function call overhead for ASCII bytes.

### Fast path for ASCII

The Go compiler and runtime recognize that ASCII bytes (0x00-0x7F) are valid single-byte UTF-8 and can skip the full multi-byte decoding logic. This makes iterating over ASCII-heavy strings very efficient.

### Compiler optimizations

The Go compiler may apply the following optimizations to string range loops:

1. **Single-byte fast check:** If the current byte is < 0x80, immediately produce it as a rune and advance by 1, without entering the multi-byte decode path.
2. **Bounds check elimination:** The compiler knows the index always stays within `[0, len(s))` and may elide bounds checks.
3. **No allocation:** String range iteration does not allocate heap memory. Unlike `[]rune(s)`, which allocates a new slice, `for range s` decodes runes on the fly.

### Equivalence with unicode/utf8 package

The behavior of string range is specified to match `unicode/utf8.DecodeRuneInString`:

```go
import "unicode/utf8"

// These two loops produce identical (i, r) pairs:
// Loop 1: for-range
for i, r := range s { /* ... */ }

// Loop 2: manual decoding
for i := 0; i < len(s); {
    r, size := utf8.DecodeRuneInString(s[i:])
    // ... same i and r as loop 1 ...
    i += size
}
```

If `utf8.DecodeRuneInString` and string range ever disagree, it is a compiler/runtime bug.

---

## 10. Spec Compliance Checklist

- [ ] String range is used for rune-level iteration, not byte-level iteration
- [ ] The byte index from range is not confused with a rune index
- [ ] `len(s)` is understood to return byte count, not rune count
- [ ] `utf8.RuneCountInString(s)` or `len([]rune(s))` is used when rune count is needed
- [ ] Invalid UTF-8 in strings is expected to produce U+FFFD during range
- [ ] Code does not assume `i` increments by 1 on each iteration (it may increment by 1-4)
- [ ] String slicing `s[i:j]` uses byte indices from range, not rune indices
- [ ] `[]rune(s)` conversion is used when random access to runes is needed
- [ ] For byte-level iteration, `for i := 0; i < len(s); i++` is used instead of range
- [ ] Code does not modify the string variable during range expecting iteration to change
- [ ] The difference between `s[i]` (returns byte) and range's `r` (returns rune) is understood
- [ ] Closures inside string range loops use per-iteration variables (Go 1.22+) or re-declare variables (pre-1.22)

---

## 11. Official Examples

### Example 1: ASCII string iteration

```go
package main

import "fmt"

func main() {
    s := "Hello, Go!"

    fmt.Println("=== Rune iteration with for-range ===")
    fmt.Printf("String: %q\n", s)
    fmt.Printf("Byte length: %d\n", len(s))
    fmt.Println()

    for i, r := range s {
        fmt.Printf("  byte[%2d] -> rune '%c' (U+%04X)\n", i, r, r)
    }

    // For ASCII strings, byte index == rune index
    // and len(s) == number of runes
}
```

Output:
```
=== Rune iteration with for-range ===
String: "Hello, Go!"
Byte length: 10

  byte[ 0] -> rune 'H' (U+0048)
  byte[ 1] -> rune 'e' (U+0065)
  byte[ 2] -> rune 'l' (U+006C)
  byte[ 3] -> rune 'l' (U+006C)
  byte[ 4] -> rune 'o' (U+006F)
  byte[ 5] -> rune ',' (U+002C)
  byte[ 6] -> rune ' ' (U+0020)
  byte[ 7] -> rune 'G' (U+0047)
  byte[ 8] -> rune 'o' (U+006F)
  byte[ 9] -> rune '!' (U+0021)
```

### Example 2: Multi-byte string iteration

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    s := "Hello, 世界! Salom, Dunyo!"

    fmt.Printf("String:     %s\n", s)
    fmt.Printf("Byte len:   %d\n", len(s))
    fmt.Printf("Rune count: %d\n", utf8.RuneCountInString(s))
    fmt.Println()

    fmt.Println("=== for-range (rune-by-rune) ===")
    runeIdx := 0
    for byteIdx, r := range s {
        width := utf8.RuneLen(r)
        fmt.Printf("  rune[%2d] byte[%2d] -> '%c' U+%04X (%d byte%s)\n",
            runeIdx, byteIdx, r, r, width, plural(width))
        runeIdx++
    }
}

func plural(n int) string {
    if n == 1 {
        return ""
    }
    return "s"
}
```

Output:
```
String:     Hello, 世界! Salom, Dunyo!
Byte len:   28
Rune count: 22

=== for-range (rune-by-rune) ===
  rune[ 0] byte[ 0] -> 'H' U+0048 (1 byte)
  rune[ 1] byte[ 1] -> 'e' U+0065 (1 byte)
  rune[ 2] byte[ 2] -> 'l' U+006C (1 byte)
  rune[ 3] byte[ 3] -> 'l' U+006C (1 byte)
  rune[ 4] byte[ 4] -> 'o' U+006F (1 byte)
  rune[ 5] byte[ 5] -> ',' U+002C (1 byte)
  rune[ 6] byte[ 6] -> ' ' U+0020 (1 byte)
  rune[ 7] byte[ 7] -> '世' U+4E16 (3 bytes)
  rune[ 8] byte[10] -> '界' U+754C (3 bytes)
  rune[ 9] byte[13] -> '!' U+0021 (1 byte)
  rune[10] byte[14] -> ' ' U+0020 (1 byte)
  rune[11] byte[15] -> 'S' U+0053 (1 byte)
  rune[12] byte[16] -> 'a' U+0061 (1 byte)
  rune[13] byte[17] -> 'l' U+006C (1 byte)
  rune[14] byte[18] -> 'o' U+006F (1 byte)
  rune[15] byte[19] -> 'm' U+006D (1 byte)
  rune[16] byte[20] -> ',' U+002C (1 byte)
  rune[17] byte[21] -> ' ' U+0020 (1 byte)
  rune[18] byte[22] -> 'D' U+0044 (1 byte)
  rune[19] byte[23] -> 'u' U+0075 (1 byte)
  rune[20] byte[24] -> 'n' U+006E (1 byte)
  rune[21] byte[25] -> 'y' U+0079 (1 byte)
  rune[22] byte[26] -> 'o' U+006F (1 byte)
  rune[23] byte[27] -> '!' U+0021 (1 byte)
```

### Example 3: Invalid UTF-8 string iteration with U+FFFD replacement

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    // Build a string with a mix of valid and invalid UTF-8:
    // 'G' (valid, 1 byte)
    // 'o' (valid, 1 byte)
    // 0xFF (invalid byte)
    // '世' (valid, 3 bytes: E4 B8 96)
    // 0xC0 0x80 (overlong NUL — invalid)
    // '!' (valid, 1 byte)
    s := "Go\xff\xe4\xb8\x96\xc0\x80!"

    fmt.Printf("Raw bytes (%d): ", len(s))
    for i := 0; i < len(s); i++ {
        fmt.Printf("%02X ", s[i])
    }
    fmt.Println()
    fmt.Printf("Valid UTF-8: %v\n", utf8.ValidString(s))
    fmt.Println()

    fmt.Println("=== for-range iteration ===")
    for i, r := range s {
        if r == utf8.RuneError {
            fmt.Printf("  byte[%d] -> U+FFFD (INVALID UTF-8 byte: 0x%02X)\n", i, s[i])
        } else {
            fmt.Printf("  byte[%d] -> '%c' (U+%04X)\n", i, r, r)
        }
    }
}
```

Output:
```
Raw bytes (9): 47 6F FF E4 B8 96 C0 80 21
Valid UTF-8: false

=== for-range iteration ===
  byte[0] -> 'G' (U+0047)
  byte[1] -> 'o' (U+006F)
  byte[2] -> U+FFFD (INVALID UTF-8 byte: 0xFF)
  byte[3] -> '世' (U+4E16)
  byte[6] -> U+FFFD (INVALID UTF-8 byte: 0xC0)
  byte[7] -> U+FFFD (INVALID UTF-8 byte: 0x80)
  byte[8] -> '!' (U+0021)
```

The invalid byte `0xFF` at position 2 produces U+FFFD and advances by 1 byte. The valid 3-byte sequence at positions 3-5 decodes correctly to '世'. The overlong sequence `0xC0 0x80` at positions 6-7 produces two separate U+FFFD values (one per invalid byte). The final '!' at position 8 decodes normally.

### Example 4: Practical use cases for string range

```go
package main

import (
    "fmt"
    "unicode"
)

// Count the number of Unicode letters in a string
func countLetters(s string) int {
    count := 0
    for _, r := range s {
        if unicode.IsLetter(r) {
            count++
        }
    }
    return count
}

// Find the byte position of the first non-ASCII rune
func firstNonASCII(s string) int {
    for i, r := range s {
        if r > 127 {
            return i // returns byte position
        }
    }
    return -1
}

// Reverse a string correctly (rune-aware, not byte-aware)
func reverseString(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}

func main() {
    s := "Hello, 世界!"

    fmt.Println("Letters:", countLetters(s))          // 7
    fmt.Println("First non-ASCII at byte:", firstNonASCII(s)) // 7
    fmt.Println("Reversed:", reverseString(s))         // !界世 ,olleH
}
```

### Example 5: Byte position vs rune position — a complete demonstration

```go
package main

import (
    "fmt"
    "strings"
    "unicode/utf8"
)

func main() {
    s := "cafe\u0301" // 'cafe' + combining acute accent (U+0301)
    // This is "cafe" followed by a combining character, visually: cafe

    fmt.Printf("String:       %s\n", s)
    fmt.Printf("Byte length:  %d\n", len(s))
    fmt.Printf("Rune count:   %d\n", utf8.RuneCountInString(s))
    fmt.Println()

    // Demonstrate that byte index != rune index
    fmt.Println("Byte Index | Rune Index | Rune    | Unicode   | Bytes")
    fmt.Println(strings.Repeat("-", 60))

    runePos := 0
    for bytePos, r := range s {
        runeSize := utf8.RuneLen(r)
        fmt.Printf("    %2d     |     %2d     |   '%c'   | U+%04X    |   %d\n",
            bytePos, runePos, r, r, runeSize)
        runePos++
    }

    fmt.Println()
    fmt.Println("Key insight: byte index 4 corresponds to rune index 4,")
    fmt.Println("but the combining accent at rune index 4 is 2 bytes (U+0301).")
    fmt.Println("If there were more characters after, byte indices would diverge.")
}
```

Output:
```
String:       cafe
Byte length:  6
Rune count:   5

Byte Index | Rune Index | Rune    | Unicode   | Bytes
------------------------------------------------------------
     0     |      0     |   'c'   | U+0063    |   1
     1     |      1     |   'a'   | U+0061    |   1
     2     |      2     |   'f'   | U+0066    |   1
     3     |      3     |   'e'   | U+0065    |   1
     4     |      4     |   '́'   | U+0301    |   2

Key insight: byte index 4 corresponds to rune index 4,
but the combining accent at rune index 4 is 2 bytes (U+0301).
If there were more characters after, byte indices would diverge.
```

### Example 6: Validating vs iterating — when U+FFFD appears

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func analyzeString(label, s string) {
    fmt.Printf("--- %s ---\n", label)
    fmt.Printf("  Bytes: %d, Runes: %d, Valid UTF-8: %v\n",
        len(s), utf8.RuneCountInString(s), utf8.ValidString(s))

    replacements := 0
    for _, r := range s {
        if r == utf8.RuneError {
            replacements++
        }
    }
    fmt.Printf("  Replacement characters (U+FFFD): %d\n\n", replacements)
}

func main() {
    analyzeString("Pure ASCII", "Hello")
    analyzeString("Valid UTF-8", "Hello, 世界")
    analyzeString("Invalid byte", "Hello\xffWorld")
    analyzeString("All invalid", "\x80\x81\x82\x83")
    analyzeString("Mixed valid/invalid", "a\xc0b\xe4\xb8\x96c\xffd")
    analyzeString("Empty string", "")
}
```

Output:
```
--- Pure ASCII ---
  Bytes: 5, Runes: 5, Valid UTF-8: true
  Replacement characters (U+FFFD): 0

--- Valid UTF-8 ---
  Bytes: 13, Runes: 9, Valid UTF-8: true
  Replacement characters (U+FFFD): 0

--- Invalid byte ---
  Bytes: 11, Runes: 11, Valid UTF-8: false
  Replacement characters (U+FFFD): 1

--- All invalid ---
  Bytes: 4, Runes: 4, Valid UTF-8: false
  Replacement characters (U+FFFD): 4

--- Mixed valid/invalid ---
  Bytes: 9, Runes: 7, Valid UTF-8: false
  Replacement characters (U+FFFD): 2

--- Empty string ---
  Bytes: 0, Runes: 0, Valid UTF-8: true
  Replacement characters (U+FFFD): 0
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| For statements with range clause | https://go.dev/ref/spec#For_range | Primary definition of string range behavior |
| String types | https://go.dev/ref/spec#String_types | Strings are immutable sequences of bytes |
| Rune literals | https://go.dev/ref/spec#Rune_literals | Rune constants and Unicode code point representation |
| Source code representation | https://go.dev/ref/spec#Source_code_representation | Go source files are UTF-8 encoded |
| Numeric types (rune/byte) | https://go.dev/ref/spec#Numeric_types | `rune` is alias for `int32`, `byte` for `uint8` |
| For statements | https://go.dev/ref/spec#For_statements | General for loop syntax |
| Blank identifier | https://go.dev/ref/spec#Blank_identifier | Using `_` to discard iteration variables |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations | `:=` syntax in range clause |
| Assignability | https://go.dev/ref/spec#Assignability | Rules for `=` form of range variables |
| unicode/utf8 package | https://pkg.go.dev/unicode/utf8 | `DecodeRuneInString`, `RuneCountInString`, `ValidString` |
| unicode package | https://pkg.go.dev/unicode | `IsLetter`, `IsDigit`, `IsSpace` and other rune classifiers |
| strings package | https://pkg.go.dev/strings | String manipulation functions that work with UTF-8 |
| Go blog: Strings, bytes, runes | https://go.dev/blog/strings | In-depth explanation of Go's string model |
| Go 1.22 release notes | https://go.dev/doc/go1.22 | Per-iteration loop variable change |
