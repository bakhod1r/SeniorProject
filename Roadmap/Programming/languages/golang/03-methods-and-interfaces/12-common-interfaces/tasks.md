# Common Interfaces — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — Implement `fmt.Stringer` for an enum

```go
type Priority int
const ( Low Priority = iota; Medium; High; Critical )
// Write Priority.String() — fmt.Println(High) → "high"
```

### Task 2 — Implement the `error` interface

Define `type NotFoundError struct{ Resource string }` so that
`fmt.Println(&NotFoundError{Resource: "user"})` prints `user not found`.

### Task 3 — Implement `io.Reader` for a string

```go
type StringReader struct { s string; pos int }
// Write Read so that io.ReadAll(&StringReader{s: "hello"}) returns []byte("hello")
```

### Task 4 — Implement `io.Writer` that counts bytes

```go
// Write CountingWriter — Write returns len(p), nil and increments a counter
```

### Task 5 — Implement `sort.Interface` for a `[]int`

Sort a `[]int` in descending order using `sort.Sort` (not `sort.Sort` with
`sort.Reverse`). Define a wrapper type.

---

## Medium 🟡

### Task 6 — Custom `MarshalJSON` with omit logic

```go
// type Profile struct { Name string; Bio string; Email *string }
// MarshalJSON must:
//  - always include "name"
//  - include "bio" only if Bio != ""
//  - include "email" only if Email != nil
```

### Task 7 — Implement `encoding.TextMarshaler` for a UUID

```go
type UUID [16]byte
// MarshalText  -> 8-4-4-4-12 hex form ("550e8400-e29b-41d4-a716-446655440000")
// UnmarshalText must parse the same form
```

### Task 8 — `io.WriterTo` optimization

Implement a `Buf` type whose `WriteTo` writes its slice in one Write call,
and verify with a benchmark that `io.Copy(dst, &buf)` uses the fast path.

### Task 9 — `http.Handler` that returns JSON

Write `JSONHandler[T any]` that wraps a function `func(*http.Request) (T,
error)` and returns either a JSON body or `http.Error`.

### Task 10 — Context-aware downloader

Write `Download(ctx context.Context, url string) ([]byte, error)` that
respects cancellation and a 10s default timeout.

### Task 11 — Implement `io.ReadCloser` for a string

A type that satisfies both `io.Reader` and `io.Closer`. `Close` should mark
the reader as closed; subsequent `Read` calls return `os.ErrClosed`.

### Task 12 — `sort.Interface` with multi-key ordering

Sort `[]Person` by `LastName` then `FirstName` then `Age`.

---

## Hard 🔴

### Task 13 — Custom `fmt.Formatter`

Implement `Money` with `Format(s fmt.State, verb rune)` supporting:

- `%v` / `%s` — `"12.50 USD"`
- `%d` — cents only (`"1250"`)
- `%+v` — verbose with tag (`"Money{cents=1250 currency=USD}"`)

### Task 14 — Pipe through a transformer

Write a `gzipWriterTo` type whose `WriteTo(w io.Writer)` reads from an inner
`io.Reader`, gzip-compresses the bytes, and writes to `w`. `io.Copy(dst,
gzipWriterTo)` should produce gzip output.

### Task 15 — Implement `sql.Scanner` and `driver.Valuer`

```go
// type Roles []string  — stored as comma-separated string in the DB
// Implement Scan and Value so it works with sql.DB.QueryRow().Scan(&r)
```

### Task 16 — Streaming HTTP handler with `http.Flusher`

Write `/events` SSE endpoint that emits a JSON event every second until the
client disconnects (use `r.Context().Done()`). Apply `http.Flusher` after
each write.

### Task 17 — Generic `iter.Seq` filter (Go 1.23+)

Write `Filter[V any](in iter.Seq[V], pred func(V) bool) iter.Seq[V]` that
yields only items passing `pred`. Add a small test with `slices.Collect`.

### Task 18 — Implement `io.Seeker` for an in-memory blob

```go
// type Blob []byte; type BlobCursor struct { b Blob; pos int64 }
// Read, Seek (SeekStart, SeekCurrent, SeekEnd), Close
// Validate negative seeks return a non-nil error
```

---

## Expert 🟣

### Task 19 — Implement `http.Hijacker`-aware WebSocket handshake

Write a function that accepts an `http.ResponseWriter`, type-asserts to
`http.Hijacker`, performs the WebSocket upgrade handshake, and returns the
`net.Conn`. (Skip the framing logic; only the handshake.)

### Task 20 — Custom `io/fs.FS` over a tar archive

Define `type TarFS struct{ entries map[string][]byte }` so that `fs.WalkDir`
and `fs.ReadFile` work correctly. Implement `Open` and `ReadDir` so
embedding into a templating layer (e.g. `html/template.ParseFS`) succeeds.

### Task 21 — Composable `context.Context` chain

Implement `WithRequestID`, `WithUser`, and `WithTrace` decorators. Each
preserves cancellation semantics of the parent. Verify by canceling the
root and observing every child's `Done` channel close.

### Task 22 — Plug-in marshaller registry

Build a registry: `RegisterMarshaler[T any](fn func(T) ([]byte, error))`.
At encode time, look up the runtime type and dispatch to the registered
function — fall back to `json.Marshal`. Use `reflect.TypeOf` for the key.

---

## Solutions

### Solution 1

```go
type Priority int

const (
    Low Priority = iota
    Medium
    High
    Critical
)

func (p Priority) String() string {
    switch p {
    case Low: return "low"
    case Medium: return "medium"
    case High: return "high"
    case Critical: return "critical"
    }
    return fmt.Sprintf("Priority(%d)", int(p))
}
```

### Solution 2

```go
type NotFoundError struct{ Resource string }

func (e *NotFoundError) Error() string {
    return e.Resource + " not found"
}
```

### Solution 3

```go
type StringReader struct {
    s   string
    pos int
}

func (r *StringReader) Read(p []byte) (int, error) {
    if r.pos >= len(r.s) {
        return 0, io.EOF
    }
    n := copy(p, r.s[r.pos:])
    r.pos += n
    return n, nil
}
```

### Solution 4

```go
type CountingWriter struct{ N int64 }

func (c *CountingWriter) Write(p []byte) (int, error) {
    c.N += int64(len(p))
    return len(p), nil
}
```

### Solution 5

```go
type DescInts []int
func (a DescInts) Len() int           { return len(a) }
func (a DescInts) Less(i, j int) bool { return a[i] > a[j] }
func (a DescInts) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

// usage: sort.Sort(DescInts(xs))
```

### Solution 6

```go
type Profile struct {
    Name  string
    Bio   string
    Email *string
}

func (p Profile) MarshalJSON() ([]byte, error) {
    out := map[string]any{"name": p.Name}
    if p.Bio != "" {
        out["bio"] = p.Bio
    }
    if p.Email != nil {
        out["email"] = *p.Email
    }
    return json.Marshal(out)
}
```

### Solution 7

```go
type UUID [16]byte

func (u UUID) MarshalText() ([]byte, error) {
    buf := make([]byte, 36)
    hex.Encode(buf[0:8], u[0:4])
    buf[8] = '-'
    hex.Encode(buf[9:13], u[4:6])
    buf[13] = '-'
    hex.Encode(buf[14:18], u[6:8])
    buf[18] = '-'
    hex.Encode(buf[19:23], u[8:10])
    buf[23] = '-'
    hex.Encode(buf[24:36], u[10:16])
    return buf, nil
}

func (u *UUID) UnmarshalText(text []byte) error {
    if len(text) != 36 {
        return fmt.Errorf("UUID: invalid length %d", len(text))
    }
    s := string(text)
    if s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
        return errors.New("UUID: invalid format")
    }
    raw := s[0:8] + s[9:13] + s[14:18] + s[19:23] + s[24:36]
    decoded, err := hex.DecodeString(raw)
    if err != nil {
        return fmt.Errorf("UUID: %w", err)
    }
    copy(u[:], decoded)
    return nil
}
```

### Solution 8

```go
type Buf struct{ data []byte }

func (b *Buf) WriteTo(w io.Writer) (int64, error) {
    n, err := w.Write(b.data)
    return int64(n), err
}

// io.Copy(dst, &Buf{data: payload}) calls WriteTo directly, skipping
// the 32 KiB buffer loop.
```

### Solution 9

```go
type JSONHandler[T any] struct {
    Fn func(*http.Request) (T, error)
}

func (h JSONHandler[T]) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    v, err := h.Fn(r)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    if err := json.NewEncoder(w).Encode(v); err != nil {
        log.Println("encode:", err)
    }
}
```

### Solution 10

```go
func Download(ctx context.Context, url string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil { return nil, err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

### Solution 11

```go
type StringReadCloser struct {
    s      string
    pos    int
    closed bool
}

func (r *StringReadCloser) Read(p []byte) (int, error) {
    if r.closed { return 0, os.ErrClosed }
    if r.pos >= len(r.s) { return 0, io.EOF }
    n := copy(p, r.s[r.pos:])
    r.pos += n
    return n, nil
}

func (r *StringReadCloser) Close() error {
    if r.closed { return os.ErrClosed }
    r.closed = true
    return nil
}
```

### Solution 12

```go
type People []Person

func (p People) Len() int      { return len(p) }
func (p People) Swap(i, j int) { p[i], p[j] = p[j], p[i] }
func (p People) Less(i, j int) bool {
    if p[i].LastName != p[j].LastName  { return p[i].LastName  < p[j].LastName }
    if p[i].FirstName != p[j].FirstName { return p[i].FirstName < p[j].FirstName }
    return p[i].Age < p[j].Age
}
```

### Solution 13

```go
type Money struct {
    Cents    int64
    Currency string
}

func (m Money) Format(s fmt.State, verb rune) {
    switch verb {
    case 'v':
        if s.Flag('+') {
            fmt.Fprintf(s, "Money{cents=%d currency=%s}", m.Cents, m.Currency)
            return
        }
        fallthrough
    case 's':
        sign, c := "", m.Cents
        if c < 0 { sign, c = "-", -c }
        fmt.Fprintf(s, "%s%d.%02d %s", sign, c/100, c%100, m.Currency)
    case 'd':
        fmt.Fprintf(s, "%d", m.Cents)
    default:
        fmt.Fprintf(s, "%%!%c(Money)", verb)
    }
}
```

### Solution 14

```go
type gzipWriterTo struct{ src io.Reader }

func (g *gzipWriterTo) WriteTo(w io.Writer) (int64, error) {
    cw := &countingWriter{w: w}
    zw := gzip.NewWriter(cw)
    if _, err := io.Copy(zw, g.src); err != nil {
        zw.Close()
        return cw.n, err
    }
    if err := zw.Close(); err != nil { return cw.n, err }
    return cw.n, nil
}

type countingWriter struct {
    w io.Writer
    n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
    n, err := c.w.Write(p)
    c.n += int64(n)
    return n, err
}
```

### Solution 15

```go
type Roles []string

func (r Roles) Value() (driver.Value, error) {
    return strings.Join(r, ","), nil
}

func (r *Roles) Scan(src any) error {
    var s string
    switch v := src.(type) {
    case string: s = v
    case []byte: s = string(v)
    case nil:    *r = nil; return nil
    default:
        return fmt.Errorf("Roles.Scan: unsupported type %T", src)
    }
    if s == "" { *r = nil; return nil }
    *r = strings.Split(s, ",")
    return nil
}
```

### Solution 16

```go
type Event struct {
    ID   int       `json:"id"`
    Time time.Time `json:"time"`
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")

    enc := json.NewEncoder(w)
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()

    for id := 0; ; id++ {
        select {
        case <-r.Context().Done():
            return
        case t := <-ticker.C:
            fmt.Fprint(w, "data: ")
            if err := enc.Encode(Event{ID: id, Time: t}); err != nil { return }
            fmt.Fprint(w, "\n")
            flusher.Flush()
        }
    }
}
```

### Solution 17

```go
func Filter[V any](in iter.Seq[V], pred func(V) bool) iter.Seq[V] {
    return func(yield func(V) bool) {
        for v := range in {
            if !pred(v) { continue }
            if !yield(v) { return }
        }
    }
}

// Test:
//   evens := Filter(slices.Values([]int{1,2,3,4}), func(v int) bool { return v%2 == 0 })
//   got := slices.Collect(evens) // [2 4]
```

### Solution 18

```go
type Blob []byte

type BlobCursor struct {
    b      Blob
    pos    int64
    closed bool
}

func (c *BlobCursor) Read(p []byte) (int, error) {
    if c.closed { return 0, os.ErrClosed }
    if c.pos >= int64(len(c.b)) { return 0, io.EOF }
    n := copy(p, c.b[c.pos:])
    c.pos += int64(n)
    return n, nil
}

func (c *BlobCursor) Seek(offset int64, whence int) (int64, error) {
    if c.closed { return 0, os.ErrClosed }
    var abs int64
    switch whence {
    case io.SeekStart:   abs = offset
    case io.SeekCurrent: abs = c.pos + offset
    case io.SeekEnd:     abs = int64(len(c.b)) + offset
    default:             return 0, errors.New("BlobCursor: invalid whence")
    }
    if abs < 0 { return 0, errors.New("BlobCursor: negative position") }
    c.pos = abs
    return abs, nil
}

func (c *BlobCursor) Close() error {
    c.closed = true
    return nil
}
```

### Solution 19

```go
func upgradeWS(w http.ResponseWriter, r *http.Request) (net.Conn, error) {
    hj, ok := w.(http.Hijacker)
    if !ok { return nil, errors.New("hijack not supported") }

    key := r.Header.Get("Sec-WebSocket-Key")
    if key == "" { return nil, errors.New("missing Sec-WebSocket-Key") }

    h := sha1.New()
    h.Write([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
    accept := base64.StdEncoding.EncodeToString(h.Sum(nil))

    conn, bufrw, err := hj.Hijack()
    if err != nil { return nil, err }

    fmt.Fprintf(bufrw,
        "HTTP/1.1 101 Switching Protocols\r\n"+
        "Upgrade: websocket\r\n"+
        "Connection: Upgrade\r\n"+
        "Sec-WebSocket-Accept: %s\r\n\r\n", accept)

    if err := bufrw.Flush(); err != nil {
        conn.Close()
        return nil, err
    }
    return conn, nil
}
```

### Solution 20

```go
type TarFS struct {
    entries map[string][]byte
}

type tarFile struct {
    name string
    data *bytes.Reader
    mode fs.FileMode
}

func (f *tarFile) Stat() (fs.FileInfo, error) {
    return &tarInfo{name: f.name, size: int64(f.data.Len()), mode: f.mode}, nil
}
func (f *tarFile) Read(p []byte) (int, error) { return f.data.Read(p) }
func (f *tarFile) Close() error               { return nil }

type tarInfo struct {
    name string
    size int64
    mode fs.FileMode
}

func (i *tarInfo) Name() string       { return path.Base(i.name) }
func (i *tarInfo) Size() int64        { return i.size }
func (i *tarInfo) Mode() fs.FileMode  { return i.mode }
func (i *tarInfo) ModTime() time.Time { return time.Time{} }
func (i *tarInfo) IsDir() bool        { return i.mode.IsDir() }
func (i *tarInfo) Sys() any           { return nil }

func (t *TarFS) Open(name string) (fs.File, error) {
    if !fs.ValidPath(name) {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
    }
    if name == "." {
        return &tarFile{name: ".", data: bytes.NewReader(nil), mode: fs.ModeDir}, nil
    }
    data, ok := t.entries[name]
    if !ok {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
    }
    return &tarFile{name: name, data: bytes.NewReader(data)}, nil
}
```

### Solution 21

```go
type ridKey struct{}
type userKey struct{}
type traceKey struct{}

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, ridKey{}, id)
}
func WithUser(ctx context.Context, user string) context.Context {
    return context.WithValue(ctx, userKey{}, user)
}
func WithTrace(ctx context.Context, trace string) context.Context {
    return context.WithValue(ctx, traceKey{}, trace)
}

func RequestIDFrom(ctx context.Context) string {
    v, _ := ctx.Value(ridKey{}).(string)
    return v
}

// Cancellation propagates because each WithValue wraps the parent without
// breaking the Done channel chain.
//
// Verification:
//   root, cancel := context.WithCancel(context.Background())
//   c1 := WithRequestID(root, "r-1")
//   c2 := WithUser(c1, "alice")
//   cancel()
//   <-c2.Done() // unblocks immediately
```

### Solution 22

```go
type marshalerFn func(any) ([]byte, error)

var (
    registry   = map[reflect.Type]marshalerFn{}
    registryMu sync.RWMutex
)

func RegisterMarshaler[T any](fn func(T) ([]byte, error)) {
    var zero T
    typ := reflect.TypeOf(zero)
    registryMu.Lock()
    registry[typ] = func(v any) ([]byte, error) { return fn(v.(T)) }
    registryMu.Unlock()
}

func Marshal(v any) ([]byte, error) {
    typ := reflect.TypeOf(v)
    registryMu.RLock()
    fn, ok := registry[typ]
    registryMu.RUnlock()
    if ok { return fn(v) }
    return json.Marshal(v)
}

// Usage:
//   RegisterMarshaler(func(t time.Time) ([]byte, error) {
//       return []byte(`"` + t.Format(time.RFC3339) + `"`), nil
//   })
//   buf, _ := Marshal(time.Now())
```
