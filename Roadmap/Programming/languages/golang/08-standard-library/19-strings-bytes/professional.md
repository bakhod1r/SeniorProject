# 8.19 `strings` and `bytes` — Professional

> **Audience.** You operate the systems that pass terabytes of text
> through Go every day. Your concerns are different from the senior
> file's: per-allocation cost, P-local pool behavior, sustained
> throughput under GC pressure, and the policies you set for the
> team — not the language. This file is the "production playbook"
> for `strings` and `bytes`.

## 1. The benchmark that decides everything

Before tuning, establish a baseline.

```go
package main

import (
    "fmt"
    "strings"
    "testing"
)

func BenchmarkConcatPlus(b *testing.B) {
    parts := []string{"the", " ", "quick", " ", "brown", " ", "fox"}
    for i := 0; i < b.N; i++ {
        var s string
        for _, p := range parts {
            s += p
        }
        _ = s
    }
}

func BenchmarkConcatBuilder(b *testing.B) {
    parts := []string{"the", " ", "quick", " ", "brown", " ", "fox"}
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        for _, p := range parts {
            sb.WriteString(p)
        }
        _ = sb.String()
    }
}

func BenchmarkConcatBuilderGrow(b *testing.B) {
    parts := []string{"the", " ", "quick", " ", "brown", " ", "fox"}
    total := 0
    for _, p := range parts { total += len(p) }
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        sb.Grow(total)
        for _, p := range parts {
            sb.WriteString(p)
        }
        _ = sb.String()
    }
}

func BenchmarkConcatSprintf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := fmt.Sprintf("%s %s %s %s", "the", "quick", "brown", "fox")
        _ = s
    }
}
```

Typical results on amd64 (Go 1.22, normalized):

| Function | ns/op | allocs/op |
|----------|-------|-----------|
| `+=` 6 times | 110 | 6 |
| `Builder` no `Grow` | 60 | 2 |
| `Builder` with `Grow` | 40 | 1 |
| `Sprintf` | 180 | 2 |

The exact numbers vary; the ratios don't. **`Builder` with a known
final size is the fastest correct option.** `Sprintf` is the slowest
because it parses the format string, boxes the arguments into
`interface{}`, and reflects on each.

## 2. The `sync.Pool` pattern, with the right `Reset`

A bare `sync.Pool` of `*bytes.Buffer` or `*strings.Builder` is the
canonical pattern. Two correctness rules:

1. **Reset before Put.** Returning a dirty buffer leaks state.
2. **Don't pool unbounded growth.** A request that writes 100 MB into
   a Buffer must not return it to the pool; the next caller would
   inherit the 100 MB allocation.

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

const maxBufCap = 1 << 20 // 1 MiB

func acquireBuf() *bytes.Buffer {
    return bufPool.Get().(*bytes.Buffer)
}

func releaseBuf(b *bytes.Buffer) {
    if b.Cap() > maxBufCap {
        return // drop the over-grown buffer; let GC collect it
    }
    b.Reset()
    bufPool.Put(b)
}
```

The "drop on too large" rule is essential. Without it, your pool
slowly fills with multi-MB buffers and your memory footprint never
shrinks.

## 3. Sanitization pipeline

A real production sanitizer (e.g., for log lines, user-facing
strings, or untrusted markup):

```go
package sanitize

import (
    "strings"
    "sync"
    "unicode"
)

var bufPool = sync.Pool{
    New: func() any { return new(strings.Builder) },
}

// LogLine returns a single-line, printable, length-capped version
// of s suitable for application logs.
func LogLine(s string, max int) string {
    sb := bufPool.Get().(*strings.Builder)
    defer func() {
        sb.Reset()
        if sb.Cap() < 1024 { // keep only small builders
            bufPool.Put(sb)
        }
    }()
    sb.Grow(min(len(s), max))

    truncated := false
    for i, r := range s {
        if i >= max {
            truncated = true
            break
        }
        switch {
        case r == '\n' || r == '\r' || r == '\t':
            sb.WriteByte(' ')
        case unicode.IsControl(r):
            sb.WriteByte('?')
        case !unicode.IsPrint(r):
            sb.WriteByte('?')
        default:
            sb.WriteRune(r)
        }
    }
    if truncated {
        sb.WriteString("...")
    }
    return sb.String()
}
```

Properties of this design:

- **Single pass.** Every input rune is touched exactly once.
- **Cap-capped.** Allocation is bounded by `max`.
- **Pool-safe.** Reset before Put; oversized builders are dropped.
- **No regex.** A regex-based sanitizer is 5–20× slower for the
  same logic.

## 4. Streaming text transformation

`strings.Split` materializes the whole result. For pipelines, stream
instead:

```go
func transform(r io.Reader, w io.Writer) error {
    br := bufio.NewReader(r)
    bw := bufio.NewWriter(w)
    defer bw.Flush()

    for {
        line, err := br.ReadSlice('\n')
        if len(line) > 0 {
            // process line — line is valid until next ReadSlice
            out := processLine(line)
            if _, werr := bw.Write(out); werr != nil {
                return werr
            }
        }
        if err == io.EOF {
            return nil
        }
        if err != nil {
            return err
        }
    }
}
```

`ReadSlice` returns a view into the bufio buffer — zero allocation
per line. If `processLine` needs to keep the line past the next
read, it must copy.

For very long lines, `ReadSlice` returns `bufio.ErrBufferFull`. Use
`Scanner` with a larger `Buffer(max)` instead, or `ReadString` if
the allocation is acceptable.

## 5. The HTML escape benchmark

`html/template` does the right thing for HTML output. When you must
escape manually (e.g., for non-template output paths), measure:

| Approach | ns/op | allocs/op |
|----------|-------|-----------|
| `html.EscapeString` | 280 | 1 |
| `strings.Replacer` (package-level) | 220 | 1 |
| Custom byte-loop into pooled `bytes.Buffer` | 90 | 0 (amortized) |

The 3× difference between `Replacer` and a hand-rolled byte loop
only matters at very high throughput (10k+ escapes per second).
Below that, use `Replacer` — it's correct, readable, and reviewed.

## 6. `bytes.NewBuffer` vs `bytes.NewBufferString`

```go
buf := bytes.NewBufferString(s) // wraps s, no copy of contents
buf := bytes.NewBuffer([]byte(s)) // converts string to []byte first
```

The second form copies the string. The first form takes ownership of
the underlying string. Both produce a `*bytes.Buffer`, but the first
is the right choice when you have a string and want to read from it
as a buffer (rare — usually you want `strings.NewReader` for read-only
access).

## 7. Concurrency boundaries

A common production mistake: passing a `*bytes.Buffer` between
goroutines without synchronization.

```go
// BAD:
go func() {
    fmt.Fprintln(buf, "from goroutine A")
}()
fmt.Fprintln(buf, "from main")
// Data race. The two writes may interleave at byte granularity.
```

Fix by ownership: only one goroutine writes. To collect from many,
funnel through a channel of `[]byte` or use `io.Pipe`:

```go
pr, pw := io.Pipe()
go func() {
    defer pw.Close()
    fmt.Fprintln(pw, "from goroutine A")
}()
io.Copy(os.Stdout, pr) // main reads
```

## 8. Logging at scale: choose the right primitive

For application logs at >10k lines/sec, `fmt.Fprintf(buf, "%s=%s", k, v)`
is not the right primitive. Each format string parse, each `interface{}`
box, each reflective branch adds up.

Idiomatic high-throughput pattern (mirrors what `slog`'s JSON handler
does):

```go
sb.WriteByte('"')
sb.WriteString(escapeKey(k))
sb.WriteByte('"')
sb.WriteByte(':')
sb.WriteByte('"')
sb.WriteString(escapeValue(v))
sb.WriteByte('"')
```

Ugly to write, 5–10× faster than `Fprintf`. Wrap in a helper, write
once, measure.

If you're building a logger from scratch, see
[`../07-slog/`](../07-slog/index.md) — `slog` already does this for
you and is the production default.

## 9. Memory budget per request

For a service that handles 10k requests/sec with a 95p latency
budget of 100ms, your string allocations are bounded:

```
10k req/s × 100ms = 1000 concurrent in-flight requests
GC target: 25% CPU = ~250ms/s of GC time available
Per request: ~250µs of GC headroom
```

That's about 100 small allocations per request before GC pressure
becomes the bottleneck. Realistic services hit 1000–10000. The
difference is where pooling pays off.

Allocations from `strings`/`bytes` to control:

| Source | Mitigation |
|--------|------------|
| `[]byte(s)` for hashing or indexing | use the `string` directly, or `unsafe.SliceData` |
| `string(b)` for return value | only convert at the API boundary, not inside loops |
| `strings.Builder` growth | call `Grow(N)` |
| `bytes.Buffer` growth | pre-allocate via `bytes.NewBuffer(make([]byte, 0, N))` |
| `Replacer` construction in hot path | move to package-level `var` |
| `Split` on large input | switch to `bufio.Scanner` or `Cut` in a loop |

## 10. The `MaxBytesReader` pattern

When reading text from untrusted input (HTTP body, file upload,
WebSocket frame), bound the size before transforming:

```go
const maxBody = 1 << 20 // 1 MiB

func handle(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, maxBody)
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "body too large or read error", http.StatusBadRequest)
        return
    }
    // body is at most 1 MiB
    process(string(body))
}
```

Without this, `io.ReadAll` happily reads a 10 GiB body into memory.
The string transformation that follows then doubles peak memory.

## 11. UTF-8 validation policy

For input that crosses a trust boundary, validate UTF-8 once and
remember the result:

```go
func validate(s string) (string, error) {
    if !utf8.ValidString(s) {
        return "", errors.New("invalid UTF-8")
    }
    return s, nil
}
```

Downstream code can then assume valid UTF-8 and use `range s`
without `RuneError` checks. The validation is one O(n) pass; the
savings are everywhere that pass would otherwise be repeated.

If you cannot reject invalid UTF-8 (legacy data, third-party feeds),
sanitize once via `strings.ToValidUTF8(s, "�")`:

```go
clean := strings.ToValidUTF8(s, "�") // replaces bad bytes with U+FFFD
```

## 12. Team policies that pay off

These are the rules that have prevented bugs at scale:

1. **Never index a string as bytes for "characters".** Use `range` or
   `utf8.DecodeRune*`. The cost of indexing is comparable; the cost of
   getting it wrong is silent data corruption.
2. **`strings.EqualFold` only for protocol identifiers.** For
   user-visible text, locale-aware comparison from `golang.org/x/text`.
3. **`Replacer` at package scope, never inside a function.** Linter
   rule if your team has a custom linter.
4. **No `fmt.Sprintf` in serialization hot paths.** Reach for a
   builder or appender first.
5. **`unsafe.String`/`unsafe.Slice` are reviewed.** Every use is a
   comment explaining why the immutability assumption holds.
6. **Bounded input + bounded buffer.** Every external string input
   has a size limit, and every buffer that holds it has a cap.

## 13. Observability

`runtime/metrics` exposes the right counters for tracking string
allocation pressure:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/gc/heap/allocs:bytes"},
    {Name: "/gc/heap/allocs:objects"},
}
metrics.Read(samples)
```

If `/gc/heap/allocs:objects` is climbing faster than your request
rate, you're allocating per-request. Profile with `pprof -alloc_objects`
to find the offender; the answer is almost always a missing pool, a
`Sprintf` in a hot path, or an unintended `[]byte(s)`/`string(b)`
conversion.

## 14. The escape hatch: `unsafe` zero-copy

When you're certain of ownership and the immutability of the source,
the Go 1.20+ APIs let you skip the copy:

```go
import "unsafe"

func bytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(&b[0], len(b))
}

func stringToBytes(s string) []byte {
    if s == "" {
        return nil
    }
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

**Production rules for these helpers:**

1. **Document why.** Every use has a comment naming the invariant.
2. **Mark the source as immutable.** The `[]byte` passed to
   `unsafe.String` is now read-only by convention. Any later write
   is a bug.
3. **Limit the scope.** A wrapper function helps the reviewer find
   every call site.
4. **Add `// +build !race`** if the helper conflicts with the race
   detector (rare).
5. **Benchmark.** If the copy isn't on the profile, don't use
   `unsafe`. The maintenance cost outweighs the gain.

## 15. References

- `runtime/string.go` — string layout.
- `strings/builder.go` — `copyCheck` and `grow`.
- `bytes/buffer.go` — `grow`, `ReadFrom`, `WriteTo`.
- `internal/bytealg/` — assembly for `IndexByte` and friends.
- [`../06-bufio/`](../06-bufio/index.md) — streaming counterpart.
- [`../07-slog/`](../07-slog/index.md) — production logger built on
  these primitives.
