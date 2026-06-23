# 8.19 `strings` and `bytes` — Find the Bug

> Twelve buggy snippets. Each compiles. Each looks reasonable. Each
> is wrong. Find the bug, explain it in one paragraph, then write
> the fix. Bug categories: encoding, allocation, aliasing, concurrency,
> API misuse.

## Bug 1 — The mysterious panic

```go
package main

import (
    "fmt"
    "strings"
)

func makeBuilder() strings.Builder {
    var b strings.Builder
    b.WriteString("hello")
    return b
}

func main() {
    b := makeBuilder()
    b.WriteString(", world")
    fmt.Println(b.String())
}
```

**What happens?**

Panics on the second `WriteString` with "strings: illegal use of
non-zero Builder copied by value".

**Why?**

`makeBuilder` returns a `Builder` by value, which copies the struct.
The Builder's first write recorded its address in `b.addr`. After
the return, the new `b` lives at a different address, but `b.addr`
still points at the old (now garbage) one. The `copyCheck` on the
next write detects `b.addr != &b` and panics.

**Fix.**

Return a pointer, or assign to a fresh Builder:

```go
func makeBuilder() *strings.Builder {
    b := &strings.Builder{}
    b.WriteString("hello")
    return b
}
```

## Bug 2 — Index out of range on UTF-8

```go
func firstChar(s string) string {
    return s[:1]
}

func main() {
    fmt.Println(firstChar("éclair")) // ???
}
```

**What happens?**

Prints `"Ã"` (or some other non-character byte). With `"éclair"` the
first byte is `0xC3`, half of the two-byte encoding of `é`.

**Why?**

`s[:1]` slices by bytes. The first rune is two bytes long.

**Fix.**

```go
func firstChar(s string) string {
    _, size := utf8.DecodeRuneInString(s)
    return s[:size]
}
```

## Bug 3 — The leaking substring

```go
type Cache struct {
    entries map[string]bool
}

func (c *Cache) Remember(req string) {
    key := req[:8] // first 8 bytes are a hash prefix
    c.entries[key] = true
}
```

**What happens?**

`Cache` slowly accumulates memory the GC can't reclaim. Profiling
shows huge "retained heap" but few apparent live strings.

**Why?**

Each `req` is a multi-MB HTTP request body. `req[:8]` produces a
string header that points into the same backing array. As long as
the cache holds any `key`, the entire `req` (and its backing buffer)
is alive.

**Fix.**

Defensive copy when the substring outlives the source:

```go
key := strings.Clone(req[:8])
// or, pre-Go-1.18:
key := string([]byte(req[:8]))
```

## Bug 4 — Bytes vs runes mismatch

```go
func censor(s string, badChars string) string {
    out := []byte(s)
    for i := range out {
        if strings.IndexByte(badChars, out[i]) >= 0 {
            out[i] = '*'
        }
    }
    return string(out)
}
```

**What happens?**

With `censor("naïve", "i")`, the byte `0xC3` of `ï` gets censored
because `IndexByte` matches single bytes. The result is a corrupted
UTF-8 sequence.

**Why?**

`out[i]` iterates by byte. Multi-byte runes get their first byte
compared against the cutset.

**Fix.**

Iterate by rune:

```go
func censor(s string, badChars string) string {
    return strings.Map(func(r rune) rune {
        if strings.ContainsRune(badChars, r) {
            return '*'
        }
        return r
    }, s)
}
```

## Bug 5 — Pool with stale data

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func format(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    fmt.Fprintf(buf, "hello, %s", name)
    return buf.String()
}
```

**What happens?**

Second and later calls return strings like `"hello, alicehello, bob"`.

**Why?**

The `defer` returns the buffer to the pool without resetting. The
next `Get` retrieves it with the previous call's contents still
present.

**Fix.**

```go
defer func() {
    buf.Reset()
    bufPool.Put(buf)
}()
```

## Bug 6 — `bytes.Buffer.Bytes()` outlives validity

```go
func parse(r io.Reader) ([]byte, error) {
    var buf bytes.Buffer
    if _, err := io.Copy(&buf, r); err != nil {
        return nil, err
    }
    result := buf.Bytes()
    buf.Reset()    // free the memory
    return result, nil
}
```

**What happens?**

The caller reads garbage from `result` after the function returns.

**Why?**

`buf.Bytes()` returns a slice into the buffer's internal storage.
`buf.Reset()` zeros the length, and the next user of that memory
(GC, pool) may overwrite it. The returned slice is dangling.

**Fix.**

Copy:

```go
return append([]byte(nil), buf.Bytes()...), nil
```

Or skip the reset; let the buffer go out of scope and let GC handle
it.

## Bug 7 — Format string in hot path

```go
func emitMetric(name string, value int) string {
    return fmt.Sprintf("metric.%s=%d", name, value)
}
```

**What happens?**

At 100k calls per second this is the top function in pprof, eating
40% of CPU.

**Why?**

`Sprintf` parses the format string, boxes both arguments into
`interface{}`, dispatches by type, and finally writes. For a known
shape, this is 3–5× slower than direct construction.

**Fix.**

```go
func emitMetric(name string, value int) string {
    var b strings.Builder
    b.Grow(len(name) + 16)
    b.WriteString("metric.")
    b.WriteString(name)
    b.WriteByte('=')
    b.Write(strconv.AppendInt(nil, int64(value), 10))
    return b.String()
}
```

(For the hottest paths, use a `sync.Pool` of Builders too.)

## Bug 8 — `unsafe.String` with aliasing

```go
func extract(buf []byte) string {
    return unsafe.String(&buf[0], len(buf))
}

func handle(c net.Conn) {
    pool := getBufferPool()
    buf := pool.Get().([]byte)
    defer pool.Put(buf)

    n, _ := c.Read(buf)
    name := extract(buf[:n])
    log.Println("got name:", name)
}
```

**What happens?**

Intermittent corruption in the log line. Under load, `name` shows
data from a different connection.

**Why?**

`extract` returns a string aliasing `buf`. The `defer` returns `buf`
to the pool. The next handler `Get`s the same buffer and overwrites
it. The first handler's `log.Println` still holds the string, but
the bytes have changed.

**Fix.**

Either copy:

```go
name := string(buf[:n])
```

Or transfer ownership: don't return the buffer to the pool while
strings derived from it are still in use.

## Bug 9 — Double escape

```go
var escaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

func process(s string) string {
    return escaper.Replace(escaper.Replace(s))
}
```

**What happens?**

`&` becomes `&amp;amp;` instead of `&amp;`.

**Why?**

Calling the escaper twice escapes the previously-inserted `&` from
`&amp;`. This pattern often comes from "I added escaping in two
places to be safe".

**Fix.**

Escape exactly once at the trust boundary. Code review enforces
this.

## Bug 10 — `Split` with regex-like intent

```go
parts := strings.Split("a, b, c", ", ")
fmt.Println(parts) // ["a", "b", "c"]

// User then adapts for variable whitespace:
parts := strings.Split("a,  b,c", ",  ")
fmt.Println(parts) // ["a", "b,c"]
```

**What happens?**

Splits only on the exact literal `, ` (two spaces). Variants don't
split.

**Why?**

`strings.Split` is exact-literal. It does not handle whitespace
variations.

**Fix.**

For whitespace-tolerant splits, post-process or use
`strings.FieldsFunc`:

```go
parts := strings.FieldsFunc("a,  b,c", func(r rune) bool {
    return r == ',' || unicode.IsSpace(r)
})
```

## Bug 11 — `Replace` with `n = 0`

```go
out := strings.Replace("aaa", "a", "b", 0)
fmt.Println(out)
```

**What happens?**

Prints `"aaa"` — nothing replaced.

**Why?**

`n == 0` means "perform zero replacements" and the function returns
the original string. For "replace all", use `-1` (or
`strings.ReplaceAll`).

**Fix.**

```go
out := strings.ReplaceAll("aaa", "a", "b")
```

## Bug 12 — Concurrent writes to `bytes.Buffer`

```go
var buf bytes.Buffer

func collect(in <-chan string) string {
    for s := range in {
        go func(s string) {
            fmt.Fprintln(&buf, s)
        }(s)
    }
    return buf.String()
}
```

**What happens?**

`go test -race` fails. Output is garbled — bytes from one write
interleaved with bytes from another. Occasionally crashes with an
index-out-of-range from the slice grow path.

**Why?**

`bytes.Buffer` is not safe for concurrent use. The race detector
catches it; without `-race` it manifests as silent corruption.

**Fix.**

Serialize through a single goroutine, or use a mutex:

```go
var (
    buf bytes.Buffer
    mu  sync.Mutex
)

mu.Lock()
fmt.Fprintln(&buf, s)
mu.Unlock()
```

Better: have each goroutine write to its own buffer and merge at
the end.

## Bonus — The benign-looking `EqualFold`

```go
func isAuthHeader(h string) bool {
    return strings.EqualFold(h, "AUTHORIZATION")
}
```

This is almost always correct — HTTP headers are ASCII and case-
insensitive. But `EqualFold` does Unicode folding, which is slower
than necessary and (in theory) could produce a false match if the
input contained a Unicode lookalike. For protocol identifiers,
prefer `textproto.CanonicalMIMEHeaderKey` or a custom ASCII-only
fold. For everything user-visible, keep `EqualFold` and accept the
cost.
