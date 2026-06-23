# Common Interfaces — Optimize

This page is about squeezing performance and clarity out of Go's most-used
standard-library interfaces. Each section gives a focused tip, a runnable
sketch, and (where useful) a `testing.B` benchmark you can adapt to your own
hot path. The advice is biased toward production servers: high QPS, low GC
pressure, and predictable latency.

---

## 1. io.WriterTo / io.ReaderFrom Fast Paths in io.Copy

`io.Copy` does more than a naive read-write loop. Before allocating a 32KiB
scratch buffer it checks two interfaces:

- If the source implements `io.WriterTo`, copy delegates to `src.WriteTo(dst)`.
- Otherwise, if the destination implements `io.ReaderFrom`, copy delegates to
  `dst.ReadFrom(src)`.

Both paths skip the user-space buffer entirely. On Linux this is how
`*os.File` to `*net.TCPConn` ends up using `sendfile(2)` and how
`*bytes.Buffer` to anything reuses its internal slice.

```go
package fastcopy

import (
    "io"
    "os"
)

// SendFile streams a file to a network connection. If both sides cooperate,
// io.Copy will pick sendfile/splice without our help.
func SendFile(dst io.Writer, path string) (int64, error) {
    f, err := os.Open(path)
    if err != nil {
        return 0, err
    }
    defer f.Close()
    return io.Copy(dst, f) // dst.ReadFrom -> sendfile when dst is *net.TCPConn
}
```

Implementing `WriteTo` on a custom reader pays off when you already hold a
contiguous buffer. Returning the byte count and an error from a single
`Write` call beats the loop every time.

```go
type Frame struct{ payload []byte }

func (f *Frame) Read(p []byte) (int, error)   { /* generic fallback */ return 0, io.EOF }
func (f *Frame) WriteTo(w io.Writer) (int64, error) {
    n, err := w.Write(f.payload)
    return int64(n), err
}
```

Rule of thumb: if your reader can produce all bytes in one shot, give it a
`WriteTo`. If your writer can consume directly from a fd, give it a
`ReadFrom`. The interface assertions are cheap; the syscall savings are not.

---

## 2. fmt.Stringer: Avoid Alloc via Preallocated Buffer / strconv.AppendInt

The lazy `Stringer` is `fmt.Sprintf("%d:%s", id, name)`. It allocates a
`*pp`, formats into it, and returns a fresh string. For a logger that runs
millions of times per second this dominates the profile.

A zero-alloc `String()` builds into a stack-sized array and uses the
`strconv.Append*` family, which never allocates if the destination has
capacity.

```go
package idstr

import "strconv"

type ID struct {
    Shard uint16
    Seq   uint64
}

func (i ID) String() string {
    var buf [32]byte
    b := strconv.AppendUint(buf[:0], uint64(i.Shard), 10)
    b = append(b, ':')
    b = strconv.AppendUint(b, i.Seq, 10)
    return string(b) // single allocation: the returned string
}
```

```go
func BenchmarkIDString(b *testing.B) {
    id := ID{Shard: 7, Seq: 1234567890}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = id.String()
    }
}
```

The single allocation is the returned string itself; if you can hand the
caller a `[]byte` (an `Append` method), you can drop even that.

---

## 3. sync.Pool with bytes.Buffer for High-Traffic Stringer/Marshaler

When a `String()` or `MarshalJSON` runs on the hot path, the temporary buffer
becomes the bottleneck. A `sync.Pool` of `*bytes.Buffer` recycles capacity
across goroutines.

```go
package logfmt

import (
    "bytes"
    "strconv"
    "sync"
)

var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

type Event struct {
    Level string
    Msg   string
    Lat   int64
}

func (e Event) String() string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    buf.WriteString(e.Level)
    buf.WriteByte(' ')
    buf.WriteString(e.Msg)
    buf.WriteByte(' ')
    buf.Write(strconv.AppendInt(nil, e.Lat, 10))
    return buf.String()
}
```

Two caveats. First, the returned string copies the pool buffer's bytes, so
the pool entry is safe to reuse the moment `String()` returns. Second, do
not retain pooled buffers past large outliers; reset them to a sane cap
before `Put` if a single call ballooned the slice. Otherwise a 1MB outlier
pins memory forever.

---

## 4. json.Marshaler: Avoid map[string]any; Use Typed Structs

`map[string]any` looks convenient until the profiler shows reflection,
sorted-key buffering, and per-value boxing dominating CPU. Typed structs let
`encoding/json` cache field metadata and emit values with no boxing.

```go
package payload

type Trade struct {
    Symbol string  `json:"sym"`
    Price  float64 `json:"px"`
    Qty    int64   `json:"qty"`
    TS     int64   `json:"ts"`
}
```

```go
func BenchmarkMarshalStruct(b *testing.B) {
    t := Trade{Symbol: "AAPL", Price: 199.20, Qty: 100, TS: 1714000000}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = json.Marshal(t)
    }
}

func BenchmarkMarshalMap(b *testing.B) {
    m := map[string]any{
        "sym": "AAPL", "px": 199.20, "qty": int64(100), "ts": int64(1714000000),
    }
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = json.Marshal(m)
    }
}
```

Typical results show the struct version 3x to 5x faster with a third of the
allocations. If you really need dynamic keys, use a slice of `KV` pairs with
a custom `MarshalJSON` that writes directly to a `bytes.Buffer`.

---

## 5. sort.Interface vs sort.Slice Closure Cost

`sort.Slice` is ergonomic, but the `less` closure is invoked through an
indirect call and forces the slice into the heap so the closure can capture
it. For large or repeated sorts, implementing `sort.Interface` directly on a
named type is meaningfully faster.

```go
package idsort

type ByPrice []Trade

func (s ByPrice) Len() int           { return len(s) }
func (s ByPrice) Less(i, j int) bool { return s[i].Price < s[j].Price }
func (s ByPrice) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
```

```go
func BenchmarkSortInterface(b *testing.B) {
    data := makeTrades(10_000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        cp := append(ByPrice(nil), data...)
        sort.Sort(cp)
    }
}

func BenchmarkSortSlice(b *testing.B) {
    data := makeTrades(10_000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        cp := append([]Trade(nil), data...)
        sort.Slice(cp, func(i, j int) bool { return cp[i].Price < cp[j].Price })
    }
}
```

Since Go 1.21 you can also use `slices.SortFunc`, which generates type-
specialised code at compile time and beats both. Reach for it first; fall
back to `sort.Interface` only when you must support older toolchains.

---

## 6. http.HandlerFunc Allocation in Hot Routers

`http.HandlerFunc` is a named function type with a method, so passing a
plain function literal to `mux.Handle` allocates an interface value and may
escape the closure to the heap. In a hyper-routed gateway this shows up as
GC pressure.

```go
// Hot path: keep handlers as package-level vars.
var listTrades = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.Write(cachedListTradesJSON())
})

func register(mux *http.ServeMux) {
    mux.Handle("/trades", listTrades) // no per-call alloc, no closure capture
}
```

Two related wins:

- Avoid capturing per-request state in handler closures; thread it through
  `context.Context` or the request itself.
- For middlewares, return the same `http.Handler` value rather than wrapping
  a fresh function literal at every call site.

---

## 7. context.Context: Avoid WithValue Chains; Small Interface Satisfaction

`context.Context` is a four-method interface. Each `context.WithValue`
allocates a new node and adds a linked-list hop to every `Value` lookup. A
deep chain turns `ctx.Value(key)` into a measurable cost.

Patterns that age well:

- Carry one struct (a `RequestScope`) under a single key, instead of a dozen
  individual values.
- Place hot fields directly on the request handler, not in context, when
  they are not needed by goroutines you spawn.

```go
type RequestScope struct {
    UserID  uint64
    TraceID string
    Tenant  string
}

type scopeKey struct{}

func WithScope(parent context.Context, s *RequestScope) context.Context {
    return context.WithValue(parent, scopeKey{}, s)
}

func ScopeOf(ctx context.Context) *RequestScope {
    s, _ := ctx.Value(scopeKey{}).(*RequestScope)
    return s
}
```

Custom `Context` types that embed another `Context` and override only one
method also work, but they only pay off if the chain is hot enough to matter
in flame graphs.

---

## 8. fs.FS: Prefer os.Root.FS for Capability Bound

`fs.FS` decouples your code from the OS file system. The default
implementation, `os.DirFS`, opens paths relative to a directory but does
*not* prevent symlink escapes. Since Go 1.24, `os.Root` provides a true
capability-bounded handle, and `Root.FS()` exposes it through the `fs.FS`
interface.

```go
package assets

import (
    "io/fs"
    "os"
)

func Open(dir string) (fs.FS, error) {
    root, err := os.OpenRoot(dir)
    if err != nil {
        return nil, err
    }
    return root.FS(), nil // every Open is verified to stay under dir
}
```

Why it matters for performance: capability checks remove the need for your
code to call `filepath.Clean` and `strings.HasPrefix` on every request. Why
it matters for security: a symlink planted by an attacker cannot reach
`/etc/passwd` through an `os.Root`-backed FS. The two wins compound.

---

## 9. iter.Seq Range-Over-Func vs Slice

Go 1.23's `iter.Seq[T]` lets you stream values without materialising a
slice. For pipelines that filter or transform large sequences, this avoids a
big allocation and improves cache behaviour.

```go
package stream

import "iter"

func Filter[T any](src iter.Seq[T], keep func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range src {
            if !keep(v) {
                continue
            }
            if !yield(v) {
                return
            }
        }
    }
}
```

```go
func BenchmarkSliceSum(b *testing.B) {
    xs := makeInts(1 << 16)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var s int
        for _, v := range xs {
            if v%2 == 0 {
                s += v
            }
        }
        sink = s
    }
}

func BenchmarkSeqSum(b *testing.B) {
    xs := makeInts(1 << 16)
    seq := Filter(slices.Values(xs), func(v int) bool { return v%2 == 0 })
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var s int
        for v := range seq {
            s += v
        }
        sink = s
    }
}
```

Sequences shine when an intermediate slice would be discarded anyway. They
do not magically beat a tight `for _, v := range xs` over a hot slice; that
loop is the most optimised pattern in Go. Use `iter.Seq` for clarity and for
not-yet-materialised data, not as a blanket replacement.

---

## 10. Devirtualization Tips for io.Reader/Writer

Calls through `io.Reader`/`io.Writer` go through an interface table by
default. The Go compiler can devirtualise these calls when the concrete type
is known at compile time, turning an indirect call into a direct one and
unlocking inlining.

Practical levers:

1. **Accept concrete types in inner loops.** A helper that takes
   `*bufio.Writer` instead of `io.Writer` skips the interface call and lets
   the compiler inline `WriteByte`.
2. **Wrap once, reuse many.** Wrapping every call in a fresh
   `bufio.NewWriter` boxes the writer repeatedly. Construct the buffered
   writer outside the loop.
3. **Use `io.Writer` only at module boundaries.** Internally, downcast once
   with a type assertion and operate on the concrete type.

```go
func writeAll(w io.Writer, lines []string) error {
    bw, ok := w.(*bufio.Writer)
    if !ok {
        bw = bufio.NewWriter(w)
        defer bw.Flush()
    }
    for _, ln := range lines {
        if _, err := bw.WriteString(ln); err != nil {
            return err
        }
        if err := bw.WriteByte('\n'); err != nil {
            return err
        }
    }
    return nil
}
```

```go
func BenchmarkWriteAllConcrete(b *testing.B) {
    var buf bytes.Buffer
    bw := bufio.NewWriter(&buf)
    lines := []string{"a", "bb", "ccc", "dddd"}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf.Reset()
        bw.Reset(&buf)
        _ = writeAll(bw, lines)
    }
}
```

You can confirm devirtualisation by compiling with
`go build -gcflags=-m=2` and looking for `devirtualizing` lines in the
output. When the compiler tells you it succeeded, the path is as fast as a
hand-written direct call — at which point the interface in the signature is
free.

---

## Putting It Together

Performance work on standard-library interfaces follows three repeating
themes:

1. **Match the fast path.** Implement `WriterTo`, `ReaderFrom`, `Append`-
   style helpers, and concrete handler types so the runtime can pick its
   best implementation.
2. **Reuse memory.** `sync.Pool`, preallocated arrays, and `Reset`-friendly
   buffers cut allocator and GC time without changing your API.
3. **Stay typed.** Generic containers (`map[string]any`, untyped closures,
   `interface{}` fields) are the easiest places to lose performance and the
   easiest to fix once measured.

Profile first, measure your changes with `testing.B` and `-benchmem`, and
keep the benchmarks in the repository so regressions show up in CI.
