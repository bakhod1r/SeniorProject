# 8.19 `strings` and `bytes` — Middle

> **Audience.** You know the basic API and `strings.Builder`. Now you
> need to choose between `Replace`, `Replacer`, and `Map`; you want a
> read/write buffer that doubles as `io.Writer`; you've seen `Cut` in
> recent code and want to know why it exists; and you're staring at a
> profiler that says half your time is in `[]byte`/`string` conversion.

## 1. `strings.NewReplacer` — many replacements in one pass

`strings.Replace` and `ReplaceAll` walk the source once per call. If
you have ten substitutions, you walk the string ten times and allocate
intermediate strings on most of them.

```go
// O(n * k) walks, k intermediate allocations:
s = strings.ReplaceAll(s, "&", "&amp;")
s = strings.ReplaceAll(s, "<", "&lt;")
s = strings.ReplaceAll(s, ">", "&gt;")
s = strings.ReplaceAll(s, "\"", "&quot;")
```

`Replacer` is the right tool. It builds a trie once, then walks the
string a single time.

```go
var htmlEscaper = strings.NewReplacer(
    "&", "&amp;",
    "<", "&lt;",
    ">", "&gt;",
    `"`, "&quot;",
)

s = htmlEscaper.Replace(s)
```

Construct it once at package scope. `Replacer` is safe for concurrent
use. It also has a streaming variant:

```go
n, err := htmlEscaper.WriteString(w, s) // w is io.Writer
```

That writes the escaped output directly to `w` without first
materializing the result string.

## 2. `strings.Map` — transform every rune

`Map` walks the string rune by rune and applies a function. Return
`-1` to drop the rune.

```go
removeNonASCII := func(r rune) rune {
    if r > 127 {
        return -1
    }
    return r
}
clean := strings.Map(removeNonASCII, "café résumé")
// clean == "caf rsum"
```

`Map` is one of the few functions where you can both transform and
filter in a single pass. It allocates a new string; for in-place
work on `[]byte`, use `bytes.Map` (same shape, different return).

## 3. `IndexFunc`, `ContainsFunc`, `IndexByte`, `IndexRune`

When you want "find the first thing matching this predicate" instead
of "find this literal substring":

```go
i := strings.IndexFunc(s, func(r rune) bool {
    return r >= '0' && r <= '9'
})
// i is byte index of the first digit, or -1
```

`IndexByte` and `IndexRune` are the literal versions, both heavily
SSE-optimized:

```go
i := strings.IndexByte(s, '\n') // fastest single-byte search
i := strings.IndexRune(s, '€')  // handles multi-byte runes
```

`bytes.IndexByte([]byte, byte)` is one of the most-called functions in
the entire standard library. The implementation is written in
assembly per architecture.

## 4. `bytes.Buffer` — the read/write buffer

`bytes.Buffer` is a growable byte buffer that implements both
`io.Reader` and `io.Writer`. It's the right tool when you need to:

- Build up output incrementally and then send it.
- Capture output from a function that writes to an `io.Writer`.
- Use a `[]byte` as if it were a stream.

```go
var buf bytes.Buffer
fmt.Fprintf(&buf, "hello, %s\n", name)
fmt.Fprintf(&buf, "today is %s\n", time.Now().Format(time.DateOnly))

// Hand the result to anything that takes io.Reader:
resp, err := http.Post(url, "text/plain", &buf)
```

Key methods:

| Method | Use |
|--------|-----|
| `Write(p []byte) (int, error)` | append bytes |
| `WriteString(s string)` | append a string without converting to []byte |
| `WriteByte(b byte)` | append one byte |
| `WriteRune(r rune)` | UTF-8 encode a rune and append |
| `Bytes() []byte` | borrow the underlying slice (no copy) |
| `String() string` | copy contents into a new string |
| `Len() int` / `Cap() int` | size and capacity |
| `Reset()` | reset length to 0, keep capacity |
| `Grow(n int)` | reserve `n` bytes upfront |
| `Read(p []byte)` | consume from front (drains the buffer) |
| `Next(n int) []byte` | return next n bytes and advance read offset |

### Pooling pattern

`bytes.Buffer` is the textbook `sync.Pool` candidate:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()
    fmt.Fprintf(buf, "hello, %s", name)
    return buf.String()
}
```

The `Reset()` before `Put` is critical — otherwise the next caller
sees stale data.

## 5. `strings.Builder` vs `bytes.Buffer`

Both grow a `[]byte` under the hood. Pick by what you need next:

| Need | Use |
|------|-----|
| Result is a `string` you'll return | `strings.Builder` |
| Result is `[]byte` going to an `io.Writer` | `bytes.Buffer` |
| You need to read from the buffer too | `bytes.Buffer` |
| You're writing to an `io.Writer` directly | neither — write to it |

`strings.Builder.String()` is a zero-copy operation (the buffer becomes
the string's backing array). `bytes.Buffer.String()` always copies.
That's the most important practical difference: when you produce a
string and never touch the buffer again, `Builder` is faster.

`Builder` also has a `copyCheck` — once you've called `.String()` or
written anything, copying the `Builder` by value panics. This prevents
accidental aliasing between the returned string and continued writes.

## 6. `strings.Cut` — the right way to split-once

Before Go 1.18, splitting on the first separator looked like this:

```go
parts := strings.SplitN(s, "=", 2)
if len(parts) != 2 { /* handle */ }
key, val := parts[0], parts[1]
```

`Cut` is the same idea without the slice allocation:

```go
key, val, found := strings.Cut(s, "=")
if !found {
    // s did not contain "="
}
```

It returns three values: the part before the separator, the part
after, and a bool. If the separator is absent, `before` is the whole
string, `after` is `""`, and `found` is `false`.

There's also `CutPrefix` and `CutSuffix` (Go 1.20+):

```go
rest, ok := strings.CutPrefix("Bearer abc123", "Bearer ")
// rest == "abc123", ok == true
```

These replace the common pattern:

```go
if strings.HasPrefix(s, p) {
    s = strings.TrimPrefix(s, p)
}
```

with a single call that does both.

## 7. `bytes.Equal`, `bytes.Compare`, `bytes.ContainsRune`

Comparing two `[]byte` values:

```go
if bytes.Equal(a, b) { ... }       // == for byte slices
if bytes.Compare(a, b) < 0 { ... } // -1, 0, +1 (like strcmp)
```

You cannot use `==` on `[]byte`; the compiler rejects it. `bytes.Equal`
is implemented with SIMD and is the fast path.

`bytes.ContainsRune`, `ContainsAny`, `ContainsFunc` mirror the
`strings` versions but accept `[]byte`.

## 8. `string` ↔ `[]byte` conversions

This is the single biggest source of allocations in string-heavy Go
code.

```go
b := []byte(s)  // allocates: copies the string's bytes
s := string(b)  // allocates: copies the byte slice's contents
```

Each conversion allocates a new backing array and copies. The compiler
optimizes a few specific patterns to avoid the copy:

```go
// Optimized — no allocation:
n := len(string(b))
i := strings.Index(string(b), "foo")
v, ok := m[string(b)]     // map lookup with []byte key
if string(b) == "literal" { ... }
for i, c := range string(b) { ... }
```

These cases work because the temporary string never escapes — the
compiler proves it's safe to alias the byte slice directly.

If you need a zero-copy conversion that's NOT one of these patterns,
Go 1.20 added two `unsafe` helpers:

```go
import "unsafe"

s := unsafe.String(&b[0], len(b))   // []byte → string, zero copy
b := unsafe.Slice(unsafe.StringData(s), len(s))  // string → []byte, zero copy
```

**Read the rules carefully:**

- After `unsafe.String`, treat the original `[]byte` as immutable.
  Mutating it after the cast is a data race against any goroutine
  reading the string.
- After `unsafe.Slice` of a string, do NOT write to the result.
  Strings are stored in read-only memory; a write will SIGSEGV.

Use these only when profiling proves the copy matters. Plain
conversions are fast enough for almost all code.

## 9. `bytes.NewReader` and `strings.NewReader`

Both wrap their input as an `io.Reader` (and many other interfaces:
`io.Seeker`, `io.ByteReader`, `io.RuneReader`, `io.WriterTo`).

```go
r := strings.NewReader("hello, world")
io.Copy(os.Stdout, r)  // writes "hello, world" to stdout
```

Use these when an API takes `io.Reader` and you have a string or byte
slice. They are zero-copy — no allocation beyond the small `Reader`
struct.

The `WriterTo` interface is the reason `io.Copy(dst, strings.NewReader(s))`
is fast: it bypasses the intermediate buffer and writes directly.

## 10. Multi-replace with `Replacer` over `[]byte`

`strings.Replacer.WriteString` writes to any `io.Writer`. Combine with
`bytes.Buffer` to operate on byte slices:

```go
var buf bytes.Buffer
htmlEscaper.WriteString(&buf, "<script>alert('xss')</script>")
// buf.Bytes() now contains the escaped output, no temporary strings
```

This pattern is the foundation of high-throughput template engines.

## 11. `strings.Fields` vs `strings.Split(s, " ")`

`Fields` splits on any run of whitespace (space, tab, newline,
unicode-defined spaces). `Split(s, " ")` splits on the literal byte
`' '` only.

```go
strings.Split("a  b", " ")  // ["a", "", "b"]  ← empty between two spaces
strings.Fields("a  b")      // ["a", "b"]       ← collapses runs
```

For user input, `Fields` is almost always what you want. For
machine-generated data with a known separator, `Split` is correct.

`SplitN(s, sep, n)` limits the result to at most `n` parts; the last
part contains the unsplit remainder.

## 12. Common middle-tier mistakes

### 12.1 Re-creating a Replacer in a hot path

```go
// BAD — allocates the replacer tree on every call:
func escape(s string) string {
    return strings.NewReplacer("&", "&amp;", "<", "&lt;").Replace(s)
}

// GOOD — construct once:
var escaper = strings.NewReplacer("&", "&amp;", "<", "&lt;")
func escape(s string) string { return escaper.Replace(s) }
```

### 12.2 Forgetting `Reset` before returning a buffer to a pool

```go
buf := bufPool.Get().(*bytes.Buffer)
// ... write to buf ...
bufPool.Put(buf)              // BUG: next caller reads stale data
// Correct: buf.Reset(); bufPool.Put(buf)
```

### 12.3 Returning a string that aliases a `[]byte` via `unsafe.String`

```go
b := readNetworkFrame() // returns []byte from a pool
s := unsafe.String(&b[0], len(b))
return s   // BUG: caller holds a string, pool reuses the bytes
```

The string and the pooled slice now share memory. The next call
overwrites the bytes the caller is reading. Either copy with
`string(b)`, or transfer ownership permanently.

### 12.4 `strings.Map` with `-1` as the "delete" signal

`Map` deletes runes that the mapper returns `-1` for. Returning `0`
keeps the `NUL` character — a different outcome. Always check which
sentinel you mean.

### 12.5 Splitting a huge file with `strings.Split`

`strings.Split` returns a slice of every part, all at once. For a
10 GB log file split on `"\n"`, that allocates 100M+ string headers
before you process the first line. Use `bufio.Scanner` instead — see
[`../06-bufio/`](../06-bufio/index.md).

## 13. A complete example: a query-string parser

```go
package main

import (
    "fmt"
    "strings"
)

// parseQuery turns "a=1&b=2&c" into a map.
// Last value wins for duplicate keys.
func parseQuery(q string) map[string]string {
    out := make(map[string]string)
    for q != "" {
        var pair string
        pair, q, _ = strings.Cut(q, "&")
        key, val, _ := strings.Cut(pair, "=")
        if key == "" {
            continue
        }
        out[key] = val
    }
    return out
}

func main() {
    m := parseQuery("user=alice&id=42&debug")
    fmt.Println(m["user"], m["id"], m["debug"])
    // alice 42 ""
}
```

No allocations except the map and its entries. `Cut` returns slices of
the original string — every key and value is a substring header into
`q`, not a copy.

## 14. Where this is heading

The senior file picks up:

- The `stringHeader` and `sliceHeader` layouts and why they share
  memory after some operations.
- Rune-correct iteration vs byte iteration — when each is right.
- `unicode/utf8` for boundary work.
- The internals of `strings.Builder` (`grow`, `copyCheck`).
- `bytes.Buffer`'s 64-byte bootstrap array and the small-buffer
  optimization.
- Profiling string code and reading the assembly of `IndexByte`.

The professional file goes from there to pooled production patterns.
