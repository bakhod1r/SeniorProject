# Common Interfaces — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Composing Reader, Writer, and Closer](#composing-reader-writer-and-closer)
3. [`io.Pipe` — A Reader and a Writer Wired Together](#iopipe-a-reader-and-a-writer-wired-together)
4. [`io.Seeker` and `io.ReaderAt`](#ioseeker-and-ioreaderat)
5. [`json.Marshaler` and `json.Unmarshaler`](#jsonmarshaler-and-jsonunmarshaler)
6. [`encoding.TextMarshaler` and friends](#encodingtextmarshaler-and-friends)
7. [`fmt.Formatter`](#fmtformatter)
8. [`http.Handler` and `http.HandlerFunc`](#httphandler-and-httphandlerfunc)
9. [`context.Context` Propagation](#contextcontext-propagation)
10. [`fs.FS`, `fs.File`, `fs.DirEntry`](#fsfs-fsfile-fsdirentry)
11. [Test](#test)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

At the junior level you implemented the headline interfaces one at a time. At the middle level the magic happens when you **compose** them: a single type that is both a `Reader` and a `Writer`, a JSON marshaler that respects a context, an HTTP handler chain built from middleware. This page walks through those composed patterns and the std-lib interfaces that drive them.

---

## Composing Reader, Writer, and Closer

`io.ReadWriter`, `io.ReadCloser`, `io.WriteCloser`, and `io.ReadWriteCloser` are pure interface compositions:

```go
type ReadWriter interface {
    Reader
    Writer
}

type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

A `*bytes.Buffer` is a `ReadWriter`; a `*os.File` is a `ReadWriteCloser`; a `*net.TCPConn` is a `ReadWriteCloser` plus several extras.

### Implementing all three on one type

```go
package main

import (
    "errors"
    "io"
)

// MemPipe is an in-memory ReadWriteCloser.
type MemPipe struct {
    buf    []byte
    pos    int    // read position
    closed bool
}

func (m *MemPipe) Write(p []byte) (int, error) {
    if m.closed {
        return 0, errors.New("write on closed pipe")
    }
    m.buf = append(m.buf, p...)
    return len(p), nil
}

func (m *MemPipe) Read(p []byte) (int, error) {
    if m.pos >= len(m.buf) {
        if m.closed {
            return 0, io.EOF
        }
        return 0, nil // would block in a real pipe
    }
    n := copy(p, m.buf[m.pos:])
    m.pos += n
    return n, nil
}

func (m *MemPipe) Close() error {
    m.closed = true
    return nil
}

// Compile-time interface checks.
var (
    _ io.Reader          = (*MemPipe)(nil)
    _ io.Writer          = (*MemPipe)(nil)
    _ io.Closer          = (*MemPipe)(nil)
    _ io.ReadWriteCloser = (*MemPipe)(nil)
)
```

### Why composition, not a god interface

Each function in the std-lib accepts the **smallest** interface it needs:

```go
// io.Copy needs only Reader and Writer
func Copy(dst Writer, src Reader) (int64, error)

// gzip.NewWriter needs only Writer
func NewWriter(w io.Writer) *Writer
```

Pass your `*MemPipe` to either. That is the [io godoc](https://pkg.go.dev/io) summary in one principle: "Accept the small interface, return the big struct."

---

## `io.Pipe` — A Reader and a Writer Wired Together

`io.Pipe` returns an `*io.PipeReader` and an `*io.PipeWriter`. Whatever you write into one comes out of the other. It is synchronous: a `Write` blocks until a `Read` consumes it.

```go
package main

import (
    "bufio"
    "fmt"
    "io"
)

func main() {
    r, w := io.Pipe()

    go func() {
        defer w.Close()
        fmt.Fprintln(w, "line 1")
        fmt.Fprintln(w, "line 2")
        fmt.Fprintln(w, "line 3")
    }()

    scanner := bufio.NewScanner(r)
    for scanner.Scan() {
        fmt.Println("got:", scanner.Text())
    }
}
```

### When to reach for `io.Pipe`

- Adapt a writer-based API to a reader-based API (or vice versa) without a backing buffer.
- Stream JSON encoding straight into an HTTP request body:

```go
r, w := io.Pipe()
go func() {
    defer w.Close()
    json.NewEncoder(w).Encode(payload)
}()
http.Post(url, "application/json", r)
```

No intermediate `bytes.Buffer` is allocated. `json.Encoder.Encode` writes; `http.Post` reads. The pipe synchronizes the two goroutines.

godoc: <https://pkg.go.dev/io#Pipe>

---

## `io.Seeker` and `io.ReaderAt`

```go
type Seeker interface {
    Seek(offset int64, whence int) (int64, error)
}

type ReaderAt interface {
    ReadAt(p []byte, off int64) (n int, err error)
}
```

`Seek` mutates a stream's position; `ReadAt` reads from an explicit offset without mutating any state — making it safe for concurrent use.

### Why `ReadAt` matters

`*os.File` implements `ReadAt`. Multiple goroutines can read from the same file at different offsets concurrently. That powers `archive/zip`, `database/sql`, and `golang.org/x/exp/mmap`.

### Implementation: in-memory `ReadSeekCloser`

```go
type MemReadSeeker struct {
    data []byte
    pos  int64
}

func (m *MemReadSeeker) Read(p []byte) (int, error) {
    if m.pos >= int64(len(m.data)) {
        return 0, io.EOF
    }
    n := copy(p, m.data[m.pos:])
    m.pos += int64(n)
    return n, nil
}

func (m *MemReadSeeker) Seek(offset int64, whence int) (int64, error) {
    var abs int64
    switch whence {
    case io.SeekStart:
        abs = offset
    case io.SeekCurrent:
        abs = m.pos + offset
    case io.SeekEnd:
        abs = int64(len(m.data)) + offset
    default:
        return 0, errors.New("invalid whence")
    }
    if abs < 0 {
        return 0, errors.New("negative position")
    }
    m.pos = abs
    return abs, nil
}

func (m *MemReadSeeker) ReadAt(p []byte, off int64) (int, error) {
    if off < 0 {
        return 0, errors.New("negative offset")
    }
    if off >= int64(len(m.data)) {
        return 0, io.EOF
    }
    n := copy(p, m.data[off:])
    if n < len(p) {
        return n, io.EOF
    }
    return n, nil
}
```

Now your type can be passed to `archive/zip.NewReader(*MemReadSeeker, size)` or wrapped with `io.SectionReader`.

godoc: <https://pkg.go.dev/io#Seeker>, <https://pkg.go.dev/io#ReaderAt>

---

## `json.Marshaler` and `json.Unmarshaler`

```go
type Marshaler interface {
    MarshalJSON() ([]byte, error)
}

type Unmarshaler interface {
    UnmarshalJSON([]byte) error
}
```

When `json.Marshal` encounters a value, it checks for `MarshalJSON`. If found, it uses the bytes you return verbatim — bypassing the struct tag pipeline entirely.

### Implementation: a marshaler that emits a custom format

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

// EpochTime serializes as a Unix timestamp instead of RFC3339.
type EpochTime time.Time

func (e EpochTime) MarshalJSON() ([]byte, error) {
    return []byte(fmt.Sprintf("%d", time.Time(e).Unix())), nil
}

func (e *EpochTime) UnmarshalJSON(b []byte) error {
    var sec int64
    if err := json.Unmarshal(b, &sec); err != nil {
        return err
    }
    *e = EpochTime(time.Unix(sec, 0))
    return nil
}

type Event struct {
    Name string    `json:"name"`
    At   EpochTime `json:"at"`
}

func main() {
    ev := Event{Name: "deploy", At: EpochTime(time.Unix(1_700_000_000, 0))}
    b, _ := json.Marshal(ev)
    fmt.Println(string(b)) // {"name":"deploy","at":1700000000}

    var got Event
    _ = json.Unmarshal(b, &got)
    fmt.Println(time.Time(got.At).UTC()) // 2023-11-14 22:13:20 +0000 UTC
}
```

### Rules

1. The bytes returned by `MarshalJSON` must be **valid JSON**. The encoder doesn't validate, but mis-formed output corrupts your stream.
2. Use a **value receiver** for `MarshalJSON` if your type semantics are immutable. Use a **pointer receiver** for `UnmarshalJSON` (you must write back into `*e`).
3. Inside `MarshalJSON` you can call `json.Marshal` on a different shape — common pattern for "encode this, but with renamed fields":

```go
func (u User) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Name  string `json:"name"`
        Age   int    `json:"age"`
        IsKid bool   `json:"is_kid"`
    }{u.Name, u.Age, u.Age < 18})
}
```

### Compose with `encoding.TextMarshaler`

If your type implements `encoding.TextMarshaler` (`MarshalText`), `json.Marshal` will call it for you and quote the result. Implementing `TextMarshaler` once gives you JSON, XML, env-var, and other encodings — see next section.

godoc: <https://pkg.go.dev/encoding/json#Marshaler>

---

## `encoding.TextMarshaler` and friends

```go
type TextMarshaler interface {
    MarshalText() (text []byte, err error)
}

type TextUnmarshaler interface {
    UnmarshalText(text []byte) error
}

type BinaryMarshaler interface {
    MarshalBinary() (data []byte, err error)
}

type BinaryUnmarshaler interface {
    UnmarshalBinary(data []byte) error
}
```

These let you serialize a type once and have many encoders use it: `encoding/json`, `encoding/xml`, `gopkg.in/yaml.v3`, and even `fmt` (for `%s`). `time.Time` famously uses these.

### Implementation: a Currency type that round-trips through any encoder

```go
type Currency string

func (c Currency) MarshalText() ([]byte, error) {
    if len(c) != 3 {
        return nil, fmt.Errorf("currency must be 3 letters, got %q", string(c))
    }
    return []byte(strings.ToUpper(string(c))), nil
}

func (c *Currency) UnmarshalText(text []byte) error {
    if len(text) != 3 {
        return fmt.Errorf("currency must be 3 letters, got %q", string(text))
    }
    *c = Currency(strings.ToUpper(string(text)))
    return nil
}
```

JSON, XML, YAML, and env-var libraries will all happily call these. You wrote the codec **once**.

godoc: <https://pkg.go.dev/encoding>

---

## `fmt.Formatter`

```go
type Formatter interface {
    Format(f State, verb rune)
}
```

`Stringer` controls `%s` and `%v`. `Formatter` is the heavyweight version — it controls **every** verb (`%d`, `%x`, `%+v`, etc.). Implement it when one type should support multiple printable forms.

```go
import "fmt"

type Hex int

func (h Hex) Format(f fmt.State, verb rune) {
    switch verb {
    case 'd':
        fmt.Fprintf(f, "%d", int(h))
    case 'x':
        fmt.Fprintf(f, "0x%x", int(h))
    case 'b':
        fmt.Fprintf(f, "0b%b", int(h))
    default:
        fmt.Fprintf(f, "Hex(%d)", int(h))
    }
}

// fmt.Printf("%d %x %b\n", Hex(42), Hex(42), Hex(42))
// 42 0x2a 0b101010
```

`fmt.State` exposes `Width()`, `Precision()`, and the `+`/`#` flags so you can honor width/precision specifiers.

godoc: <https://pkg.go.dev/fmt#Formatter>

---

## `http.Handler` and `http.HandlerFunc`

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

`HandlerFunc` is the canonical adapter pattern: a function type with a method, so a plain function can satisfy `Handler`.

### Middleware is a Handler that wraps a Handler

```go
func WithLogging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
    })
}

mux := http.NewServeMux()
mux.HandleFunc("/", index)
http.ListenAndServe(":8080", WithLogging(mux))
```

### `http.Flusher` and `http.Hijacker`

These are **optional** interfaces that an `http.ResponseWriter` may also satisfy:

```go
type Flusher interface {
    Flush()
}

type Hijacker interface {
    Hijack() (net.Conn, *bufio.ReadWriter, error)
}
```

Idiomatic usage: type-assert and use if available.

```go
func sse(w http.ResponseWriter, r *http.Request) {
    fl, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", 500)
        return
    }
    w.Header().Set("Content-Type", "text/event-stream")
    for i := 0; i < 5; i++ {
        fmt.Fprintf(w, "data: tick %d\n\n", i)
        fl.Flush()
        time.Sleep(time.Second)
    }
}
```

`Hijacker` is what allows WebSocket libraries to take over the raw TCP connection.

godoc: <https://pkg.go.dev/net/http#Handler>, <https://pkg.go.dev/net/http#Flusher>, <https://pkg.go.dev/net/http#Hijacker>

---

## `context.Context` Propagation

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

`context.Context` is the spine of cancellation in modern Go. The contract:
1. Pass it as the **first argument** of any function that does I/O or waits.
2. Never store it in a struct (passing it through is fine).
3. Always check `ctx.Done()` or pass it to a context-aware API.

### Implementation: an HTTP-aware service

```go
type UserService struct {
    db *sql.DB
}

func (s *UserService) Find(ctx context.Context, id string) (*User, error) {
    row := s.db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = $1", id)
    var u User
    if err := row.Scan(&u.Name); err != nil {
        return nil, err
    }
    return &u, nil
}

func (s *UserService) Slow(ctx context.Context) error {
    select {
    case <-time.After(5 * time.Second):
        return nil
    case <-ctx.Done():
        return ctx.Err() // returns context.DeadlineExceeded or context.Canceled
    }
}
```

When the HTTP handler's request is cancelled, `ctx.Done()` closes, the SQL driver bails out, and the user gets the right error instead of a hung goroutine.

### Implementing your own `context.Context` (rare, but possible)

```go
// requestIDContext wraps a parent and exposes a request ID via Value.
type requestIDContext struct {
    context.Context
    id string
}

type requestIDKey struct{}

func (c *requestIDContext) Value(key any) any {
    if _, ok := key.(requestIDKey); ok {
        return c.id
    }
    return c.Context.Value(key)
}

// Use:
ctx := &requestIDContext{Context: parent, id: "abc-123"}
```

Real code uses `context.WithValue(parent, key, val)` instead — this is just to show that `Context` is just an interface.

godoc: <https://pkg.go.dev/context#Context>

---

## `fs.FS`, `fs.File`, `fs.DirEntry`

Go 1.16 introduced an abstract filesystem:

```go
type FS interface {
    Open(name string) (File, error)
}

type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}

type DirEntry interface {
    Name() string
    IsDir() bool
    Type() FileMode
    Info() (FileInfo, error)
}
```

`os.DirFS("/etc")`, `embed.FS`, and `archive/zip.Reader` all satisfy `fs.FS`. Code that takes an `fs.FS` works against real disk, embedded files, or a zip archive — interchangeable.

### Reading from an embedded FS

```go
import (
    "embed"
    "io/fs"
)

//go:embed config/*
var configFS embed.FS

func loadConfig(name string) ([]byte, error) {
    return fs.ReadFile(configFS, "config/"+name)
}
```

### Implementing a tiny `fs.FS`

```go
type MapFS map[string]string

func (m MapFS) Open(name string) (fs.File, error) {
    data, ok := m[name]
    if !ok {
        return nil, fs.ErrNotExist
    }
    return &mapFile{name: name, r: strings.NewReader(data)}, nil
}

type mapFile struct {
    name string
    r    *strings.Reader
}

func (f *mapFile) Stat() (fs.FileInfo, error) { return mapInfo{f.name, int64(f.r.Len())}, nil }
func (f *mapFile) Read(p []byte) (int, error) { return f.r.Read(p) }
func (f *mapFile) Close() error               { return nil }

type mapInfo struct {
    name string
    size int64
}

func (i mapInfo) Name() string       { return i.name }
func (i mapInfo) Size() int64        { return i.size }
func (i mapInfo) Mode() fs.FileMode  { return 0444 }
func (i mapInfo) ModTime() time.Time { return time.Time{} }
func (i mapInfo) IsDir() bool        { return false }
func (i mapInfo) Sys() any           { return nil }
```

Now `fs.ReadFile(MapFS{"hello": "world"}, "hello")` works.

godoc: <https://pkg.go.dev/io/fs>

---

## Test

### 1. What does `var _ io.ReadWriter = (*bytes.Buffer)(nil)` do?
- a) Allocates a buffer
- b) Compile-time check that `*bytes.Buffer` satisfies `io.ReadWriter`
- c) Runtime panic
- d) Nothing — it's removed by the compiler

**Answer: b**

### 2. `io.Pipe` is best described as:
- a) A buffered channel of bytes
- b) A synchronous in-memory connection between a Writer and Reader
- c) An async I/O queue
- d) A file-backed FIFO

**Answer: b**

### 3. Why use a pointer receiver for `UnmarshalJSON`?
- a) Performance
- b) Required by the json package
- c) The method must mutate the receiver
- d) Both b and c

**Answer: c** (the std-lib only requires the method exist on the pointer's method set; mutation needs pointer receiver)

### 4. Inside an `http.Handler`, how do you stream chunks to the client?
- a) Type-assert `http.Flusher` and call `Flush()`
- b) Set `Connection: close`
- c) Return early
- d) Spawn a goroutine

**Answer: a**

### 5. The first argument to any function doing I/O should be:
- a) `*sql.DB`
- b) `context.Context`
- c) `io.Writer`
- d) `error`

**Answer: b**

---

## Cheat Sheet

```
COMPOSITION
─────────────────────────────────
io.ReadWriter   = Reader + Writer
io.ReadCloser   = Reader + Closer
io.RWCloser     = Reader + Writer + Closer
Pass smallest interface, return concrete type

PIPE
─────────────────────────────────
r, w := io.Pipe()
Write(w) blocks until Read(r) consumes
Close w to signal EOF on r

SEEKER / READERAT
─────────────────────────────────
Seek mutates position
ReadAt is safe for concurrent use
*os.File implements both

JSON
─────────────────────────────────
MarshalJSON() ([]byte, error)         value receiver
UnmarshalJSON([]byte) error           pointer receiver
Inside MarshalJSON: re-shape and json.Marshal that
Implement TextMarshaler once → JSON+XML+YAML

HTTP
─────────────────────────────────
http.Handler       — ServeHTTP
http.HandlerFunc   — adapt a func to Handler
http.Flusher       — type-assert; call Flush()
http.Hijacker      — take over raw TCP

CONTEXT
─────────────────────────────────
First parameter, always
Never store in a struct
Pass through, do not derive once and stash

FS
─────────────────────────────────
fs.FS    — Open(name) (File, error)
fs.File  — Stat, Read, Close
embed.FS, os.DirFS, zip.Reader all satisfy fs.FS
```

---

## Summary

The middle-level skill is **composition**:

1. Build types that satisfy multiple I/O interfaces at once.
2. Use `io.Pipe` to bridge Writer-shaped APIs to Reader-shaped APIs.
3. Implement `json.Marshaler`/`Unmarshaler` for custom serialization, falling back to `encoding.TextMarshaler` for "encode once, use everywhere."
4. Wrap HTTP handlers as middleware via `http.HandlerFunc`.
5. Thread `context.Context` through every function that waits.
6. Use `fs.FS` to abstract over real disk, embedded files, and archives.

In senior.md we go under the hood: how `io.Copy` checks for `WriterTo`/`ReaderFrom` for fast paths, how the runtime caches itabs, and how to enforce contracts in your own libraries.
