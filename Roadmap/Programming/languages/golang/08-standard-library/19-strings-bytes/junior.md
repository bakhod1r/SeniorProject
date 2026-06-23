# 8.19 `strings` and `bytes` — Junior

> **Audience.** You can concatenate strings with `+` and you know
> `len(s)` gives you a byte count. But you've hit a case where your
> naïve loop is slow, your index arithmetic is off for non-ASCII text,
> or you're not sure which of the two dozen `strings` functions to
> reach for. By the end of this file you will know the 20 functions
> that cover 95% of day-to-day string work, how `strings.Builder`
> eliminates allocations, what `bytes` adds, and the two mistakes that
> hurt the most beginners.

## 1. What a `string` really is

A Go `string` is a read-only slice of bytes. Under the hood the runtime
represents it as a two-word header:

```
type stringHeader struct {
    Data unsafe.Pointer  // pointer to the first byte
    Len  int             // byte count, not rune count
}
```

Three consequences every Go programmer must internalize:

1. **Strings are immutable.** You cannot write `s[0] = 'H'`. Any
   operation that "changes" a string allocates new backing memory and
   returns a new string.

2. **`len(s)` is bytes, not characters.** `len("café")` is 5, not 4,
   because `é` is two UTF-8 bytes.

3. **Slicing a string does not copy.** `s[1:4]` returns a new header
   pointing into the same backing array. This is cheap but means a
   small slice can keep a large allocation alive.

```go
package main

import "fmt"

func main() {
    s := "café"
    fmt.Println(len(s))       // 5 (bytes)
    fmt.Println(s[0])         // 99 ('c' as byte)
    fmt.Println(string(s[0])) // "c"

    // Iterating by rune (correct for Unicode):
    for i, r := range s {
        fmt.Printf("index %d: rune %c (%d bytes)\n", i, r, len(string(r)))
    }
    // index 0: rune c (1 bytes)
    // index 1: rune a (1 bytes)
    // index 2: rune f (1 bytes)
    // index 3: rune é (2 bytes)
}
```

## 2. Searching and testing

### `strings.Contains`

```go
import "strings"

strings.Contains("seafood", "foo")  // true
strings.Contains("seafood", "bar")  // false
strings.Contains("seafood", "")     // true (every string contains "")
```

### `strings.HasPrefix` and `strings.HasSuffix`

```go
strings.HasPrefix("Gopher", "Go")  // true
strings.HasSuffix("Gopher", "er")  // true
```

Prefer these over `s[:2] == "Go"` — they handle the len-check for you
and are more readable.

### `strings.Count`

```go
strings.Count("cheese", "e")  // 3
strings.Count("five", "")     // 5 (len("five")+1, counts between each rune and at ends)
```

### `strings.Index` and friends

```go
strings.Index("chicken", "ken")    // 4  (-1 if not found)
strings.LastIndex("go gopher", "go") // 3
strings.IndexByte("hello", 'l')    // 2
strings.IndexRune("hello, 世界", '界') // 9
```

`Index` finds the first occurrence. `LastIndex` finds the last. All
return -1 on failure.

## 3. Splitting and joining

### `strings.Split`

```go
parts := strings.Split("a,b,c", ",")
// ["a", "b", "c"]

// Split on empty string gives individual UTF-8 characters:
strings.Split("abc", "")
// ["a", "b", "c"]

// Trailing separator produces empty trailing element:
strings.Split("a,b,", ",")
// ["a", "b", ""]
```

### `strings.SplitN`

Stops after at most `n` substrings. Useful when you know the structure:

```go
strings.SplitN("a:b:c:d", ":", 3)
// ["a", "b", "c:d"]  — the third element holds the rest
```

### `strings.Fields`

Splits on any whitespace (space, tab, newline) and discards leading,
trailing, and repeated whitespace:

```go
strings.Fields("  foo bar  baz   ")
// ["foo", "bar", "baz"]
```

`Fields` is almost always what you want for tokenizing human-readable
input. Use `Split` only when the separator is meaningful (CSV, path
components, etc.).

### `strings.Join`

```go
strings.Join([]string{"a", "b", "c"}, ", ")
// "a, b, c"
```

`Join` is the inverse of `Split`. It never allocates more memory than
it needs — it pre-computes the total length and allocates once.

## 4. Trimming

### `strings.TrimSpace`

```go
strings.TrimSpace("  hello world  \n")
// "hello world"
```

Almost always the right first step when processing user input or file
lines.

### `strings.Trim`

Removes a set of characters (as a cutset) from both ends:

```go
strings.Trim("***hello***", "*")  // "hello"
strings.Trim("¡¡¡hola!!!", "¡!")  // "hola"
```

Note: the second argument is a **set** of characters to remove, not a
substring. `strings.Trim("abcba", "ab")` returns `"c"`.

### `strings.TrimPrefix` and `strings.TrimSuffix`

Remove an exact prefix or suffix (not a set):

```go
strings.TrimPrefix("Hello, World", "Hello, ")  // "World"
strings.TrimSuffix("hello.go", ".go")           // "hello"

// If the prefix/suffix isn't present, the original string is returned unchanged:
strings.TrimPrefix("Hello", "Bye")  // "Hello"
```

Use `TrimPrefix`/`TrimSuffix` when you want exact matching. Use `Trim`
when you want to strip any combination of certain characters.

### `strings.TrimLeft` and `strings.TrimRight`

Like `Trim` but only one side:

```go
strings.TrimLeft("***hello***", "*")   // "hello***"
strings.TrimRight("***hello***", "*")  // "***hello"
```

## 5. Replacing

### `strings.Replace`

```go
strings.Replace("oink oink oink", "oink", "moo", 2)
// "moo moo oink"  — replaces the first 2 occurrences

strings.Replace("oink oink oink", "oink", "moo", -1)
// "moo moo moo"  — -1 means replace all
```

### `strings.ReplaceAll`

`ReplaceAll(s, old, new)` is a shorthand for `Replace(s, old, new, -1)`:

```go
strings.ReplaceAll("foo bar foo", "foo", "baz")
// "baz bar baz"
```

## 6. Case conversion

```go
strings.ToLower("Gopher")  // "gopher"
strings.ToUpper("Gopher")  // "GOPHER"
strings.Title("hello world")  // "Hello World" (deprecated; use golang.org/x/text/cases)
```

`ToLower` and `ToUpper` are Unicode-aware. `strings.ToLower("HÉLLO")`
produces `"héllo"` correctly.

### `strings.EqualFold`

Case-insensitive equality without allocating a lowercase copy:

```go
strings.EqualFold("Go", "go")     // true
strings.EqualFold("Go", "GO")     // true
strings.EqualFold("Go", "java")   // false
```

Always prefer `EqualFold` over `strings.ToLower(a) == strings.ToLower(b)`.

## 7. Repeating

```go
strings.Repeat("ab", 3)  // "ababab"
strings.Repeat("-", 40)  // "----------------------------------------"
```

## 8. `strings.Builder` — efficient concatenation

The single most important performance lesson in this file: **do not use
`+=` to build a string in a loop.**

```go
// BAD — O(n²) allocations
func joinBad(words []string) string {
    s := ""
    for _, w := range words {
        s += w + " "
    }
    return s
}
```

Every `+=` allocates a brand-new backing array, copies all existing
bytes into it, then copies the new bytes. With 1000 words, you do
1000 allocations and copy roughly n²/2 bytes total.

`strings.Builder` solves this:

```go
package main

import (
    "fmt"
    "strings"
)

func joinGood(words []string) string {
    var b strings.Builder
    for _, w := range words {
        b.WriteString(w)
        b.WriteByte(' ')
    }
    return b.String()
}

func main() {
    words := []string{"the", "quick", "brown", "fox"}
    fmt.Println(joinGood(words))
    // "the quick brown fox "
}
```

`strings.Builder` holds a `[]byte` internally and grows it with
doubling — the same strategy as `append`. The final `String()` call
converts the slice to a string **without copying** (using an unsafe
trick the stdlib is allowed to use).

### Builder methods

```go
var b strings.Builder

b.WriteString("hello")   // write a string
b.WriteByte(' ')         // write a single byte
b.WriteRune('世')        // write a Unicode code point
b.Write([]byte("data"))  // write a []byte (implements io.Writer)

b.Len()    // current byte count
b.Cap()    // current capacity
b.Reset()  // clear contents but keep allocated memory
b.String() // return the accumulated string
```

### Preallocating with `Grow`

If you know an upper bound on the final size, preallocate to avoid
repeated doubling:

```go
var b strings.Builder
b.Grow(1024) // reserve at least 1024 bytes
for _, line := range lines {
    b.WriteString(line)
    b.WriteByte('\n')
}
```

## 9. `strings.Reader`

`strings.Reader` wraps a string and implements `io.Reader`,
`io.ReaderAt`, `io.Seeker`, `io.WriterTo`, and `io.ByteScanner`. Use
it whenever an API requires an `io.Reader` and you have a string:

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func main() {
    r := strings.NewReader("Hello, Gopher!")
    buf := make([]byte, 5)
    for {
        n, err := r.Read(buf)
        if n > 0 {
            fmt.Printf("%q\n", buf[:n])
        }
        if err == io.EOF {
            break
        }
    }
}
// "Hello"
// ", Gop"
// "her!"
```

## 10. When to use `bytes` vs `strings`

The `bytes` package mirrors the `strings` API almost exactly. The
rule of thumb:

| Situation | Use |
|-----------|-----|
| Input is already a `string` and output is `string` | `strings` |
| Input is `[]byte` (from `io.Read`, JSON, protobuf) | `bytes` |
| You need to mutate in place | `bytes` |
| You're building output for an `io.Writer` | `bytes.Buffer` |
| You're building a `string` return value | `strings.Builder` |

Converting between them:

```go
s := "hello"
b := []byte(s)   // copies: new backing array
s2 := string(b)  // copies: new backing array

// The compiler elides the copy in certain specific patterns
// (map lookup, comparison) — see middle.md for details.
```

## 11. Core `bytes` functions

Every `strings` function has a `bytes` equivalent with `[]byte`
arguments and return types. The most common:

```go
import "bytes"

bytes.Contains([]byte("seafood"), []byte("foo"))   // true
bytes.HasPrefix([]byte("Gopher"), []byte("Go"))    // true
bytes.HasSuffix([]byte("Gopher"), []byte("er"))    // true
bytes.Count([]byte("cheese"), []byte("e"))         // 3
bytes.Index([]byte("chicken"), []byte("ken"))      // 4

bytes.Split([]byte("a,b,c"), []byte(","))          // [['a'] ['b'] ['c']]
bytes.Join([][]byte{{'a'}, {'b'}}, []byte(", "))   // "a, b"
bytes.Fields([]byte("  foo bar  "))                // [['f','o','o'] ['b','a','r']]

bytes.TrimSpace([]byte("  hello  "))               // "hello"
bytes.TrimPrefix([]byte("hello.go"), []byte(".go")) // "hello"

bytes.ToLower([]byte("HELLO"))  // "hello"
bytes.ToUpper([]byte("hello"))  // "HELLO"
bytes.EqualFold([]byte("Go"), []byte("go"))  // true

bytes.Replace([]byte("aaa"), []byte("a"), []byte("b"), 2)  // "bba"
bytes.ReplaceAll([]byte("aaa"), []byte("a"), []byte("b"))   // "bbb"
bytes.Repeat([]byte("ab"), 3)   // "ababab"
```

And the key additions that `strings` doesn't have:

```go
bytes.Equal([]byte("abc"), []byte("abc"))  // true (strings use == directly)
bytes.Compare([]byte("a"), []byte("b"))    // -1, 0, or 1
```

## 12. Two mistakes that hurt the most

### Mistake 1: byte-indexing into a UTF-8 string

```go
s := "café"
fmt.Println(s[3]) // 195 — this is the first byte of 'é', not 'é' itself
```

If your string might contain non-ASCII characters, never index with
`s[i]` unless you are deliberately working at the byte level (e.g.,
parsing a wire protocol). Use `for i, r := range s` for character
iteration.

### Mistake 2: `+` concatenation in a loop

Already shown in section 8, but worth repeating: `+=` in a loop is
O(n²). Even 10,000 concatenations of short strings produce tens of
thousands of allocations. Always use `strings.Builder` (or
`bytes.Buffer`) when accumulating output iteratively.

## Quick reference

| Task | Function |
|------|----------|
| Check substring | `strings.Contains` |
| Check prefix/suffix | `strings.HasPrefix`, `strings.HasSuffix` |
| Find position | `strings.Index`, `strings.LastIndex` |
| Split on separator | `strings.Split`, `strings.SplitN` |
| Split on whitespace | `strings.Fields` |
| Join slice | `strings.Join` |
| Strip whitespace | `strings.TrimSpace` |
| Strip char set | `strings.Trim`, `strings.TrimLeft`, `strings.TrimRight` |
| Strip exact prefix/suffix | `strings.TrimPrefix`, `strings.TrimSuffix` |
| Replace occurrences | `strings.Replace`, `strings.ReplaceAll` |
| Case | `strings.ToLower`, `strings.ToUpper` |
| Case-insensitive compare | `strings.EqualFold` |
| Repeat | `strings.Repeat` |
| Build a string | `strings.Builder` |
| Wrap string as io.Reader | `strings.NewReader` |
