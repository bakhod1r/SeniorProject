# 8.19 `strings` and `bytes` — Optimize

> Ten optimization exercises. Each starts with slow code that works
> and ends with fast code that still works. Measure with `go test
> -bench=. -benchmem` before and after. Numbers are illustrative;
> your machine will be within 2× of these.

## Setup

```go
package perf

import "testing"

// Benchmark template:
func BenchmarkX(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = doSlow() // or doFast()
    }
}
```

Run with `go test -bench=. -benchmem -benchtime=1s`.

## O1 — Replace `+=` with `strings.Builder.Grow`

### Before

```go
func ConcatSlow(parts []string) string {
    var s string
    for _, p := range parts {
        s += p
    }
    return s
}
```

Result for 100 parts of 10 bytes each:

```
BenchmarkConcatSlow    50000  ~24000 ns/op   ~5500 B/op   ~99 allocs/op
```

### After

```go
func ConcatFast(parts []string) string {
    total := 0
    for _, p := range parts { total += len(p) }
    var b strings.Builder
    b.Grow(total)
    for _, p := range parts { b.WriteString(p) }
    return b.String()
}
```

```
BenchmarkConcatFast    2000000   ~600 ns/op   ~1024 B/op   1 allocs/op
```

40× faster, 100× fewer allocations.

## O2 — Move `strings.NewReplacer` to package scope

### Before

```go
func EscapeHTML(s string) string {
    return strings.NewReplacer(
        "&", "&amp;",
        "<", "&lt;",
        ">", "&gt;",
    ).Replace(s)
}
```

Constructs the replacer on every call. Replacer construction builds
a trie (or hash table) — measurable cost.

### After

```go
var htmlEscaper = strings.NewReplacer(
    "&", "&amp;",
    "<", "&lt;",
    ">", "&gt;",
)

func EscapeHTML(s string) string {
    return htmlEscaper.Replace(s)
}
```

2–4× faster on short inputs (where construction dominates).

## O3 — Pool `bytes.Buffer`

### Before

```go
func Render(name string) string {
    var buf bytes.Buffer
    fmt.Fprintf(&buf, "hello, %s\n", name)
    return buf.String()
}
```

### After

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func Render(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        if buf.Cap() > 1<<14 { return } // drop oversized
        bufPool.Put(buf)
    }()
    fmt.Fprintf(buf, "hello, %s\n", name)
    return buf.String()
}
```

At sustained throughput, pool re-use eliminates the per-call
allocation (you still pay for the final string).

## O4 — Replace `fmt.Sprintf("%d", n)` with `strconv`

### Before

```go
func Format(n int) string {
    return fmt.Sprintf("%d", n)
}
```

### After

```go
func Format(n int) string {
    return strconv.Itoa(n)
}
```

5–10× faster (no format-string parsing, no `interface{}` boxing).

## O5 — Use `AppendInt` to avoid the intermediate string

### Before

```go
func Build(name string, id int) string {
    return name + "/" + strconv.Itoa(id)
}
```

Three allocations: `Itoa`'s string, the concat result.

### After

```go
func Build(name string, id int) string {
    b := make([]byte, 0, len(name)+12)
    b = append(b, name...)
    b = append(b, '/')
    b = strconv.AppendInt(b, int64(id), 10)
    return string(b)
}
```

One allocation (the `string(b)` conversion; the `b` slice is on the
stack via escape analysis on most compilers when sized inline).

## O6 — `strings.Builder` instead of `string` concatenation in templates

### Before

```go
func Sprintf(rows []Row) string {
    var out string
    for _, r := range rows {
        out += fmt.Sprintf("<tr><td>%s</td><td>%d</td></tr>", r.Name, r.Age)
    }
    return out
}
```

### After

```go
func Sprintf(rows []Row) string {
    var b strings.Builder
    b.Grow(64 * len(rows))
    for _, r := range rows {
        b.WriteString("<tr><td>")
        b.WriteString(html.EscapeString(r.Name))
        b.WriteString("</td><td>")
        b.Write(strconv.AppendInt(nil, int64(r.Age), 10))
        b.WriteString("</td></tr>")
    }
    return b.String()
}
```

Two wins: no per-iteration concatenation, no per-iteration
`Sprintf`. Typically 10×.

## O7 — Avoid `[]byte(s)` in map lookups

### Before

```go
func Lookup(m map[string]int, b []byte) (int, bool) {
    v, ok := m[string(b)]
    return v, ok
}
```

Wait — this is already optimized. The compiler special-cases
`m[string(b)]` to avoid the allocation. Verify by running with
`-gcflags="-m"`; you should see no escape for the `string(b)`
expression.

### When the optimization doesn't apply

```go
key := string(b)
v, ok := m[key]
```

Here `key` is a separate variable; the compiler can no longer prove
the temporary doesn't escape and the conversion allocates. Keep the
expression inline.

## O8 — Pre-allocate slices of strings

### Before

```go
func Lines(s string) []string {
    var out []string
    for _, line := range strings.Split(s, "\n") {
        if line != "" {
            out = append(out, line)
        }
    }
    return out
}
```

`strings.Split` allocates a `[]string` sized for every split; the
loop discards empties. Two passes' worth of work.

### After

```go
func Lines(s string) []string {
    n := strings.Count(s, "\n") + 1
    out := make([]string, 0, n)
    for s != "" {
        line, rest, _ := strings.Cut(s, "\n")
        if line != "" {
            out = append(out, line)
        }
        s = rest
    }
    return out
}
```

`Count` is fast (SIMD). `Cut` avoids materializing the full slice.
One pre-sized allocation.

## O9 — `bytes.NewBuffer(make([]byte, 0, N))` for known sizes

### Before

```go
var buf bytes.Buffer
fmt.Fprintf(&buf, "...") // many writes
return buf.Bytes()
```

The buffer starts empty, grows on demand. Each grow copies.

### After

```go
buf := bytes.NewBuffer(make([]byte, 0, 1024))
fmt.Fprintf(buf, "...")
return buf.Bytes()
```

Pre-sized; no grow if the final output fits. For sizes you can
estimate, this halves CPU in the build path.

## O10 — Replace regex with primitives

### Before

```go
var tagRE = regexp.MustCompile(`<[^>]*>`)

func StripTags(s string) string {
    return tagRE.ReplaceAllString(s, "")
}
```

### After

```go
func StripTags(s string) string {
    var b strings.Builder
    b.Grow(len(s))
    for {
        lt := strings.IndexByte(s, '<')
        if lt < 0 {
            b.WriteString(s)
            break
        }
        b.WriteString(s[:lt])
        gt := strings.IndexByte(s[lt:], '>')
        if gt < 0 {
            b.WriteString(s[lt:])
            break
        }
        s = s[lt+gt+1:]
    }
    return b.String()
}
```

5–20× faster than the regex form. `IndexByte` is assembly; regex
runs a small NFA.

The regex version is fine when the pattern actually requires regex
features (alternation, captures, anchors). For fixed delimiters,
primitives win.

## Bonus — Profile-guided choices

The unifying principle behind all of these: **don't optimize without
a profile**. CPU profile (`-cpuprofile=cpu.out`) tells you where
time goes; allocation profile (`-memprofile=mem.out -benchmem`)
tells you where the GC pressure comes from.

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -top cpu.out
go tool pprof -alloc_objects mem.out
```

In `pprof -alloc_objects`, look for entries like:

- `runtime.mallocgc` from `string(b)` / `[]byte(s)` conversions.
- `runtime.growslice` from `bytes.Buffer` or `strings.Builder` grows.
- `runtime.makeslice` from `strings.Split`.

Each maps to one of the optimizations above.

## Checklist

When a hot path involves text:

- [ ] One allocation per call, not N.
- [ ] `Builder.Grow(N)` called with the right N.
- [ ] `Replacer`, `Regex` instances at package scope.
- [ ] No `fmt.Sprintf` in inner loops.
- [ ] No `string(b)` / `[]byte(s)` outside the optimized patterns.
- [ ] `sync.Pool` for buffers in concurrent hot paths.
- [ ] Pool drains oversized buffers instead of caching them.
- [ ] `bufio` for streaming inputs > a few KB.

If all the boxes are checked and the profile still shows text work,
the next question is "are we doing more text than needed?" —
restructuring the data (e.g., emitting bytes directly to the wire
rather than building strings) often beats further micro-optimization.
