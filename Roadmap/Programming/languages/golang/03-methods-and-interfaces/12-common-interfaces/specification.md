# Common Interfaces — Specification

> **Official Reference**
> Source: [Go Standard Library Documentation](https://pkg.go.dev/std)
> Topical sources: `builtin`, `fmt`, `io`, `sort`, `encoding`, `encoding/json`,
> `net/http`, `context`, `io/fs`, `iter`, `database/sql`, `database/sql/driver`.
>
> The Go specification only defines interfaces as a structural type
> (https://go.dev/ref/spec#Interface_types). The "common interfaces" we describe
> here are **not language-level**; they are conventions established by the
> standard library and respected throughout the ecosystem.

---

## Table of Contents

1. [What "Common Interfaces" Means](#1-what-common-interfaces-means)
2. [The `error` Interface](#2-the-error-interface)
3. [`fmt.Stringer` and `fmt.Formatter`](#3-fmtstringer-and-fmtformatter)
4. [The `io` Interface Family](#4-the-io-interface-family)
5. [`sort.Interface`](#5-sortinterface)
6. [Marshalers: `json`, `encoding.TextMarshaler`, `encoding.BinaryMarshaler`](#6-marshalers-json-encodingtextmarshaler-encodingbinarymarshaler)
7. [`net/http` Interfaces](#7-nethttp-interfaces)
8. [`context.Context`](#8-contextcontext)
9. [`io/fs.FS`, `iter.Seq`, and `database/sql` Interfaces](#9-iofsfs-iterseq-and-databasesql-interfaces)
10. [Contract Rules and Defined Behavior](#10-contract-rules-and-defined-behavior)
11. [Version History and Compliance Checklist](#11-version-history-and-compliance-checklist)

---

## 1. What "Common Interfaces" Means

The Go language specification defines `interface` as the type whose method set
is its identity. The **common interfaces** are a small, conventional set of
interface types declared in the standard library that:

- Have stable, documented contracts.
- Are accepted by many functions across the ecosystem.
- Compose readily (for example `io.ReadCloser = io.Reader + io.Closer`).
- Are detected by libraries via type assertions to enable optimizations
  (for example `io.Copy` checks for `io.WriterTo` and `io.ReaderFrom`).

Implementing a common interface is the primary way a user-defined type
"plugs in" to standard library facilities — `fmt.Println`, `json.Marshal`,
`http.Handler`, `sort.Sort`, `bufio.NewReader`, and so on. Because these
interfaces are tiny (one or two methods) and orthogonal, they support the
"accept interfaces, return structs" idiom.

### Where the contracts live

Each interface declaration is annotated with a doc comment that defines the
contract. The contract is **prose**, not code, so static checking cannot
verify it; testing is the only enforcement. The remainder of this document
distills the contracts directly from those doc comments.

---

## 2. The `error` Interface

Source: https://pkg.go.dev/builtin#error

### Declaration

```go
type error interface {
    Error() string
}
```

`error` is one of only a few predeclared interface types in the language; it
lives in the universe block, so no import is needed.

### Contract

- The returned string SHOULD describe what failed, not where.
- `Error()` SHOULD NOT capitalize the first letter and SHOULD NOT end with
  punctuation. Source: https://go.dev/wiki/CodeReviewComments#error-strings.
- A nil `error` value indicates success. A non-nil value indicates failure;
  the concrete type may carry additional context.

### Implementing

```go
type ParseError struct {
    Line int
    Msg  string
}

func (e *ParseError) Error() string {
    return fmt.Sprintf("parse error at line %d: %s", e.Line, e.Msg)
}
```

### Wrapping (Go 1.13+)

A package-defined error type that wishes to participate in `errors.Is` and
`errors.As` may implement two optional helpers:

```go
type WrappedErr struct {
    Op  string
    Err error
}

func (w *WrappedErr) Error() string { return w.Op + ": " + w.Err.Error() }
func (w *WrappedErr) Unwrap() error { return w.Err }
```

Source: https://pkg.go.dev/errors#Unwrap. `errors.Is` walks the chain via
`Unwrap()`; `errors.As` performs type-assertion at each level. Go 1.20 added
multi-error wrapping with `errors.Join` and `Unwrap() []error`.

---

## 3. `fmt.Stringer` and `fmt.Formatter`

Source: https://pkg.go.dev/fmt#Stringer, https://pkg.go.dev/fmt#Formatter

### `Stringer`

```go
type Stringer interface {
    String() string
}
```

`fmt` package functions (`Print`, `Printf`, `Println`, `Sprintf`) call
`String()` whenever they need a textual representation of a value with the
`%s` or `%v` verb (and the value is not already a string).

### Implementing `Stringer`

```go
type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusClosed
)

func (s Status) String() string {
    switch s {
    case StatusPending: return "pending"
    case StatusActive:  return "active"
    case StatusClosed:  return "closed"
    }
    return fmt.Sprintf("Status(%d)", int(s))
}
```

### Pitfall — Infinite Recursion

If `String()` calls `fmt.Sprintf("%v", s)` on the **same** value, the runtime
re-enters `String()` and the program panics with a stack overflow. Always
convert to the underlying type:

```go
func (s Status) String() string {
    return fmt.Sprintf("Status(%d)", int(s))  // int(s), not s
}
```

### `Formatter`

```go
type Formatter interface {
    Format(f State, verb rune)
}
```

`Formatter` overrides `fmt`'s default verb processing. It is implemented when
you need `%x`, `%+v`, width, precision, or plus/minus flags to behave
differently from the default. `State` exposes the writer, flag tests, and
width/precision queries.

```go
type Money struct {
    Cents int64
    Currency string
}

func (m Money) Format(s fmt.State, verb rune) {
    switch verb {
    case 'v', 's':
        fmt.Fprintf(s, "%d.%02d %s", m.Cents/100, m.Cents%100, m.Currency)
    case 'd':
        fmt.Fprintf(s, "%d", m.Cents)
    default:
        fmt.Fprintf(s, "%%!%c(Money=%d %s)", verb, m.Cents, m.Currency)
    }
}
```

When both `Stringer` and `Formatter` are implemented, `Formatter` wins for
the verbs it handles; `Stringer` is only consulted as a fallback.

---

## 4. The `io` Interface Family

Source: https://pkg.go.dev/io

The `io` package declares a set of single-method interfaces that compose into
larger contracts. They are the most-imitated interfaces in Go.

### Core single-method interfaces

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

type Closer interface {
    Close() error
}

type Seeker interface {
    Seek(offset int64, whence int) (int64, error)
}

type ReaderAt interface {
    ReadAt(p []byte, off int64) (n int, err error)
}

type WriterAt interface {
    WriteAt(p []byte, off int64) (n int, err error)
}
```

### Reader contract — verbatim

> Read reads up to len(p) bytes into p. It returns the number of bytes read
> (0 <= n <= len(p)) and any error encountered. Even if Read returns
> n < len(p), it may use all of p as scratch space during the call. If some
> data is available but not len(p) bytes, Read conventionally returns what
> is available instead of waiting for more.
>
> When Read encounters an error or end-of-file condition after successfully
> reading n > 0 bytes, it returns the number of bytes read. It may return
> the (non-nil) error from the same call or return the error (and n == 0)
> from a subsequent call. An instance of this general case is that a Reader
> returning a non-zero number of bytes at the end of the input stream may
> return either err == EOF or err == nil. The next Read should return 0, EOF.

Source: https://pkg.go.dev/io#Reader

Two notes:

1. `n > 0` with `err != nil` is **valid**. Callers must process the bytes
   *before* checking the error.
2. Returning `(0, nil)` is "discouraged" and should be treated as a no-op,
   not as EOF.

### Writer contract

> Write writes len(p) bytes from p to the underlying data stream. It returns
> the number of bytes written from p (0 <= n <= len(p)) and any error
> encountered that caused the write to stop early. Write must return a
> non-nil error if it returns n < len(p). Write must not modify the slice
> data, even temporarily.

Source: https://pkg.go.dev/io#Writer

### Optimization interfaces — `WriterTo` and `ReaderFrom`

```go
type WriterTo interface {
    WriteTo(w Writer) (n int64, err error)
}

type ReaderFrom interface {
    ReadFrom(r Reader) (n int64, err error)
}
```

`io.Copy(dst, src)` checks both ends for these:

```go
// io.Copy implementation outline (real source: src/io/io.go)
func Copy(dst Writer, src Reader) (int64, error) {
    if wt, ok := src.(WriterTo); ok { return wt.WriteTo(dst) }
    if rf, ok := dst.(ReaderFrom); ok { return rf.ReadFrom(src) }
    // fall back to a generic 32 KiB buffer loop
}
```

This is why `*os.File`, `*bytes.Buffer`, and `*net.TCPConn` can use
`sendfile(2)` or `splice(2)` under the hood — they implement `ReadFrom` /
`WriteTo`.

### Composed interfaces

```go
type ReadWriter      interface { Reader; Writer }
type ReadCloser      interface { Reader; Closer }
type WriteCloser     interface { Writer; Closer }
type ReadWriteCloser interface { Reader; Writer; Closer }
type ReadSeeker      interface { Reader; Seeker }
```

These enable callers to declare a parameter type that requires multiple
behaviors without inventing a new interface.

### Implementing a Reader

A typical "rate-limited" wrapper:

```go
type LimitReader struct {
    R io.Reader
    N int64 // remaining bytes
}

func (l *LimitReader) Read(p []byte) (int, error) {
    if l.N <= 0 { return 0, io.EOF }
    if int64(len(p)) > l.N { p = p[0:l.N] }
    n, err := l.R.Read(p)
    l.N -= int64(n)
    return n, err
}
```

`io.LimitReader` itself is structured the same way (slightly different field
names).

---

## 5. `sort.Interface`

Source: https://pkg.go.dev/sort#Interface

### Declaration

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

### Contract

- `Less(i, j)` MUST define a strict weak order: irreflexive, asymmetric,
  transitive on equality.
- `Swap` MUST exchange elements at positions `i` and `j`.
- `Len` MUST return a value that does not change between `Less`/`Swap` calls
  during a single sort run.

`sort.Sort` is **not stable**; `sort.Stable` is. Both are O(n log n).

### Idiomatic implementation

```go
type ByAge []Person

func (a ByAge) Len() int           { return len(a) }
func (a ByAge) Less(i, j int) bool { return a[i].Age < a[j].Age }
func (a ByAge) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

sort.Sort(ByAge(people))
```

### Generic alternatives (Go 1.21+)

`slices.Sort`, `slices.SortFunc`, and `slices.SortStableFunc` largely replace
hand-written `sort.Interface` for slices of comparable types. The interface
is still used for non-slice containers and for sorts driven by external
indices.

---

## 6. Marshalers: `json`, `encoding.TextMarshaler`, `encoding.BinaryMarshaler`

### `json.Marshaler` / `json.Unmarshaler`

Source: https://pkg.go.dev/encoding/json#Marshaler

```go
type Marshaler interface {
    MarshalJSON() ([]byte, error)
}

type Unmarshaler interface {
    UnmarshalJSON([]byte) error
}
```

Contract:

- `MarshalJSON` MUST return valid JSON.
- `UnmarshalJSON` MUST be able to decode the JSON form produced by
  `MarshalJSON`.
- The encoder calls `MarshalJSON` on a value before applying struct-tag
  rules, so a custom marshaler bypasses field tags.

### Implementing with omit logic

```go
type Optional[T any] struct {
    Set   bool
    Value T
}

func (o Optional[T]) MarshalJSON() ([]byte, error) {
    if !o.Set { return []byte("null"), nil }
    return json.Marshal(o.Value)
}

func (o *Optional[T]) UnmarshalJSON(data []byte) error {
    if string(data) == "null" {
        o.Set = false
        var zero T
        o.Value = zero
        return nil
    }
    if err := json.Unmarshal(data, &o.Value); err != nil { return err }
    o.Set = true
    return nil
}
```

### `encoding.TextMarshaler`

Source: https://pkg.go.dev/encoding#TextMarshaler

```go
type TextMarshaler interface {
    MarshalText() (text []byte, err error)
}

type TextUnmarshaler interface {
    UnmarshalText(text []byte) error
}
```

`encoding/json` falls back to `TextMarshaler` when there is no
`MarshalJSON`, wrapping the result in a JSON string. `encoding/xml`,
`flag.TextVar`, and `database/sql` (`sql.Scanner` for textual columns) also
look for `TextMarshaler` / `TextUnmarshaler`.

### `encoding.BinaryMarshaler`

```go
type BinaryMarshaler interface {
    MarshalBinary() (data []byte, err error)
}

type BinaryUnmarshaler interface {
    UnmarshalBinary(data []byte) error
}
```

Used by `encoding/gob` and by some `encoding/xml` paths. Reach for it when
you have a tightly packed binary format (e.g. a UUID).

### Detection order in `encoding/json`

For a value of type `T`:

1. If `T` implements `json.Marshaler` — call it.
2. Else if `T` implements `encoding.TextMarshaler` — call it, wrap in a JSON
   string.
3. Else fall back to reflection-based encoding.

The same precedence applies on decode.

---

## 7. `net/http` Interfaces

Source: https://pkg.go.dev/net/http

### `http.Handler`

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

The single entry point for HTTP request handling. `*ServeMux`, middleware,
and custom routers all implement `Handler`. `http.HandlerFunc` is an
adapter that turns a function into a `Handler`.

```go
type Healthz struct{ db *sql.DB }

func (h *Healthz) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if err := h.db.PingContext(r.Context()); err != nil {
        http.Error(w, err.Error(), http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
    _, _ = w.Write([]byte("ok"))
}
```

### `http.Flusher`

```go
type Flusher interface {
    Flush()
}
```

Source: https://pkg.go.dev/net/http#Flusher. The default `ResponseWriter`
implementation also implements `Flusher`. Type-assert before using:

```go
func sse(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/event-stream")
    for i := 0; i < 5; i++ {
        fmt.Fprintf(w, "data: tick %d\n\n", i)
        flusher.Flush()
        time.Sleep(time.Second)
    }
}
```

### `http.Hijacker`

```go
type Hijacker interface {
    Hijack() (net.Conn, *bufio.ReadWriter, error)
}
```

Allows a handler to take over the underlying TCP connection (for example, a
WebSocket upgrade). After `Hijack` returns, the HTTP server no longer owns
the connection — the handler is responsible for closing it.

### `http.CloseNotifier` (deprecated)

Replaced by `Request.Context().Done()` in Go 1.7+.

---

## 8. `context.Context`

Source: https://pkg.go.dev/context#Context

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

### Contract highlights

- `Done()` returns a channel that is closed when work on behalf of the
  context should be canceled.
- `Err()` returns nil if `Done()` is not yet closed; otherwise it returns
  `context.Canceled` or `context.DeadlineExceeded`.
- `Value(key)` is for *request-scoped* data only — never for optional
  function parameters.

### Implementing a custom Context

Most custom contexts wrap an existing one:

```go
type tenantCtx struct {
    context.Context
    tenant string
}

type tenantKey struct{}

func WithTenant(parent context.Context, t string) context.Context {
    return context.WithValue(parent, tenantKey{}, t)
}

func TenantFrom(ctx context.Context) (string, bool) {
    t, ok := ctx.Value(tenantKey{}).(string)
    return t, ok
}
```

Source: https://go.dev/blog/context. Note the `tenantKey{}` empty struct used
to avoid collisions with other packages' keys.

### Cancellation propagation

```go
func fetch(ctx context.Context, url string) error {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil { return err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err } // includes ctx.Err() when canceled
    defer resp.Body.Close()
    _, err = io.Copy(io.Discard, resp.Body)
    return err
}
```

Calling `cancel := context.WithCancel(parent)` and then `cancel()` closes
the channel; any goroutine waiting on `ctx.Done()` unblocks.

---

## 9. `io/fs.FS`, `iter.Seq`, and `database/sql` Interfaces

### `io/fs.FS` (Go 1.16+)

Source: https://pkg.go.dev/io/fs#FS

```go
type FS interface {
    Open(name string) (File, error)
}
```

A read-only filesystem abstraction. `embed.FS`, `os.DirFS`, and `zip.Reader`
implement it. Optional richer interfaces include `fs.ReadDirFS`,
`fs.StatFS`, `fs.SubFS`, and `fs.GlobFS`. Functions in `io/fs` (e.g.
`fs.WalkDir`, `fs.ReadFile`) prefer the optional interface when present and
fall back to the minimal `FS`.

### `iter.Seq` and `iter.Seq2` (Go 1.23+)

Source: https://pkg.go.dev/iter

```go
type Seq[V any]      func(yield func(V) bool)
type Seq2[K, V any]  func(yield func(K, V) bool)
```

These are not interface types but **function types** that participate in
`for ... range` (the range-over-func feature). A producer drives `yield`
until `yield` returns `false`, indicating the consumer wants to stop.

```go
func Counter(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) { return }
        }
    }
}

for v := range Counter(5) { fmt.Println(v) } // 0 1 2 3 4
```

`iter.Pull` and `iter.Pull2` convert a push-style `Seq` into pull-style
iterators with `next` and `stop` functions. Many `slices` and `maps`
helpers added in Go 1.23 return `iter.Seq[*]`.

### `driver.Valuer` and `sql.Scanner`

Source: https://pkg.go.dev/database/sql/driver#Valuer,
https://pkg.go.dev/database/sql#Scanner

```go
// in database/sql/driver
type Valuer interface {
    Value() (Value, error)
}

// in database/sql
type Scanner interface {
    Scan(src any) error
}
```

`Valuer` produces a value the driver knows how to send; `Scanner` consumes
a column value into a destination. Together they let user-defined types
participate in `sql.DB` round-trips.

```go
type Tags []string

func (t Tags) Value() (driver.Value, error) {
    return strings.Join(t, ","), nil
}

func (t *Tags) Scan(src any) error {
    var s string
    switch v := src.(type) {
    case string: s = v
    case []byte: s = string(v)
    case nil:    *t = nil; return nil
    default: return fmt.Errorf("Tags.Scan: unsupported type %T", src)
    }
    if s == "" { *t = nil; return nil }
    *t = strings.Split(s, ",")
    return nil
}
```

`driver.Value` is a closed type set: `int64`, `float64`, `bool`, `[]byte`,
`string`, `time.Time`, or nil. Anything outside must be coerced.

---

## 10. Contract Rules and Defined Behavior

### Common implementation rules

1. **Receiver consistency.** If even one method on the type has a pointer
   receiver, all methods that mutate state SHOULD have pointer receivers.
   For interfaces with optional features (e.g. `io.WriterTo`), receiver
   choice should match the primary interface (`io.Reader`).
2. **Nil receivers.** A method may legitimately accept a nil receiver if the
   doc comment says so (e.g. `(*Logger).Log` may discard).
3. **Goroutine safety.** Unless the doc comment promises it, an interface
   method is NOT safe for concurrent use. `io.Reader` and `io.Writer` are
   famously NOT goroutine-safe; `context.Context` IS.
4. **Returning n > 0 with err != nil.** Allowed for `Reader`; required to
   handle for `Writer` only when n < len(p).
5. **Idempotent Close.** `io.Closer.Close` should tolerate being called
   multiple times; the second call may return an error, but it must not
   panic.

### Optional interface detection

Standard library functions probe for richer interfaces:

| Function | Probes |
|---|---|
| `io.Copy(dst, src)` | `WriterTo`, `ReaderFrom` |
| `bufio.NewReader` | `Reader` (no probe; uses as-is) |
| `http.ServeContent` | `io.Seeker`, `io.ReaderAt` |
| `encoding/json.Marshal` | `Marshaler`, `TextMarshaler` |
| `fmt.Sprint` | `Formatter`, `Stringer`, `error` |
| `database/sql` driver | `driver.Valuer`, `sql.Scanner` |

Implementing the optional interface is the canonical way to opt into the
fast path.

### Type assertion patterns

```go
// Comma-ok form — safe.
if rf, ok := dst.(io.ReaderFrom); ok { return rf.ReadFrom(src) }

// Compile-time interface assertion — useful in package init.
var _ http.Handler = (*Healthz)(nil)
```

The blank-identifier assignment is a common idiom: it forces a compile error
if `*Healthz` ever stops satisfying `http.Handler`.

---

## 11. Version History and Compliance Checklist

### Version history

| Go Version | Change |
|---|---|
| Go 1.0 | `error`, `fmt.Stringer`, all `io.*` interfaces, `sort.Interface`, `http.Handler` defined. |
| Go 1.0 | `encoding.TextMarshaler` / `BinaryMarshaler` defined. |
| Go 1.7 | `context.Context` moved into the standard library; `Request.Context()` added. |
| Go 1.13 | `errors.Is`, `errors.As`, `errors.Unwrap` — formal wrapping protocol. |
| Go 1.16 | `io/fs.FS` and family added; `embed` integrates with it. |
| Go 1.18 | Generics; existing interfaces unchanged but new generic helpers (`slices`, `maps`) reduce hand-written `sort.Interface`. |
| Go 1.20 | `errors.Join` and multi-error `Unwrap() []error`. |
| Go 1.21 | `slices.Sort`, `cmp.Ordered`. |
| Go 1.22 | `http.ServeMux` patterns; no interface change. |
| Go 1.23 | `iter.Seq` and `iter.Seq2`; range-over-func; `slices.All`, `maps.Keys` etc. return `iter.Seq*`. |

### Compliance checklist for an interface implementer

- [ ] Read the full doc comment of the interface, not just the signature.
- [ ] Match the contract on error returns, partial reads/writes, and zero
      results.
- [ ] Decide receiver kind once and apply it consistently.
- [ ] Add a compile-time `var _ I = (*T)(nil)` assertion.
- [ ] If implementing `Reader` or `Writer`, also evaluate `ReadFrom` /
      `WriteTo` for performance hooks.
- [ ] Document goroutine safety in your own doc comment.
- [ ] When wrapping, expose the inner type via an `Unwrap`-style method or
      via embedding so that callers can downgrade through the wrapper.
- [ ] For marshalers, ensure round-trip equality on the values you care
      about and add tests.

### Quick spec-anchor index

| Interface | Anchor |
|---|---|
| `error` | https://pkg.go.dev/builtin#error |
| `fmt.Stringer` | https://pkg.go.dev/fmt#Stringer |
| `fmt.Formatter` | https://pkg.go.dev/fmt#Formatter |
| `io.Reader` | https://pkg.go.dev/io#Reader |
| `io.Writer` | https://pkg.go.dev/io#Writer |
| `io.Closer` | https://pkg.go.dev/io#Closer |
| `io.Seeker` | https://pkg.go.dev/io#Seeker |
| `io.ReaderAt` | https://pkg.go.dev/io#ReaderAt |
| `io.WriterTo` | https://pkg.go.dev/io#WriterTo |
| `io.ReaderFrom` | https://pkg.go.dev/io#ReaderFrom |
| `sort.Interface` | https://pkg.go.dev/sort#Interface |
| `json.Marshaler` | https://pkg.go.dev/encoding/json#Marshaler |
| `encoding.TextMarshaler` | https://pkg.go.dev/encoding#TextMarshaler |
| `encoding.BinaryMarshaler` | https://pkg.go.dev/encoding#BinaryMarshaler |
| `http.Handler` | https://pkg.go.dev/net/http#Handler |
| `http.Flusher` | https://pkg.go.dev/net/http#Flusher |
| `http.Hijacker` | https://pkg.go.dev/net/http#Hijacker |
| `context.Context` | https://pkg.go.dev/context#Context |
| `io/fs.FS` | https://pkg.go.dev/io/fs#FS |
| `iter.Seq` | https://pkg.go.dev/iter#Seq |
| `driver.Valuer` | https://pkg.go.dev/database/sql/driver#Valuer |
| `sql.Scanner` | https://pkg.go.dev/database/sql#Scanner |

A type that satisfies all the rules above plays well with every standard
library facility that consumes that interface — and, by extension, with the
broader ecosystem that follows the same conventions.
