# Common Interfaces — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: What is the `error` interface and where is it declared?

**Answer:** `error` is a predeclared interface in the universe block:

```go
type error interface {
    Error() string
}
```

You do not import any package to use it. Any type with an `Error() string`
method satisfies it.

### Q2: Why do we implement `fmt.Stringer`?

**Answer:** `fmt.Println`, `fmt.Sprintf`, and `fmt.Printf` (with `%s` or `%v`)
call `String()` automatically. Implementing `Stringer` gives types a clean
default textual form.

```go
type Status int
func (s Status) String() string { return []string{"new","done"}[s] }
fmt.Println(Status(1)) // "done"
```

### Q3: What method does `io.Reader` require?

**Answer:** A single method, `Read(p []byte) (n int, err error)`. It reads up
to `len(p)` bytes into `p` and returns how many were actually read.

### Q4: What does `io.Writer` look like?

**Answer:**

```go
type Writer interface {
    Write(p []byte) (n int, err error)
}
```

It writes the bytes from `p`. If `n < len(p)`, the call MUST return a non-nil
error.

### Q5: Why is the standard error string convention "no capital letter, no period"?

**Answer:** Errors are often wrapped — e.g. `fmt.Errorf("open: %w", err)`. A
chain like `"open: Connection refused."` looks ugly. Lowercase, no trailing
punctuation composes cleanly.

### Q6: What is `http.Handler`?

**Answer:**

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

Any type that implements `ServeHTTP` can serve HTTP requests. It is the
foundation of `net/http`'s server model.

### Q7: Why use the blank identifier in `var _ io.Reader = (*MyReader)(nil)`?

**Answer:** It is a compile-time interface assertion. If `*MyReader` ever
stops implementing `io.Reader`, the build fails — a tiny, free regression
test placed near the type declaration.

### Q8: What is `sort.Interface`?

**Answer:** A three-method interface used by `sort.Sort`:

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

You implement these three methods on your data type to make it sortable.

### Q9: Difference between `json.Marshal` on a struct vs implementing `json.Marshaler`?

**Answer:** Default `json.Marshal` uses reflection over struct fields and
respects `json:"..."` tags. Implementing `MarshalJSON()` overrides that
entirely — you produce the bytes yourself, and field tags are ignored.

### Q10: What is `context.Context` for?

**Answer:** A standard interface to carry deadlines, cancellation signals,
and request-scoped values across API boundaries — especially for goroutines
and IO operations like HTTP requests and database queries.

---

## Middle-Level Questions

### Q11: When can `io.Reader.Read` return `n > 0` together with `err == io.EOF`?

**Answer:** That is explicitly allowed by the `Reader` contract. Callers MUST
process the `n` bytes first, then check the error. Writing the loop the
wrong way around drops the last chunk:

```go
// WRONG
for {
    n, err := r.Read(buf)
    if err != nil { break } // loses the n bytes
    process(buf[:n])
}

// RIGHT
for {
    n, err := r.Read(buf)
    if n > 0 { process(buf[:n]) }
    if err == io.EOF { break }
    if err != nil { return err }
}
```

### Q12: What is the `io.WriterTo` / `io.ReaderFrom` optimization?

**Answer:** `io.Copy(dst, src)` first asks: does `src` implement `WriterTo`?
If yes, calls `src.WriteTo(dst)`. Otherwise: does `dst` implement
`ReaderFrom`? If yes, calls `dst.ReadFrom(src)`. Both bypass the generic 32
KiB buffer loop. `*os.File` exploits this to use `sendfile(2)` on Linux,
copying without traversing user space.

```go
// fast path — sendfile under the hood
io.Copy(dstFile, srcFile)
```

### Q13: Why does `bytes.Buffer` implement `io.Writer` with a pointer receiver?

**Answer:** `Write` mutates the underlying byte slice. A value receiver
would write to a copy and lose the data. Receiver consistency is the rule:
mutating method => pointer receiver.

### Q14: What does the `http.Flusher` interface enable?

**Answer:** Server-Sent Events and other streaming responses. The default
`ResponseWriter` buffers writes; calling `Flush()` pushes them to the client
immediately. Type-assert to use it:

```go
flusher, ok := w.(http.Flusher)
if !ok { http.Error(...); return }
flusher.Flush()
```

### Q15: How do you implement `sort.Interface` for a slice of structs?

**Answer:**

```go
type People []Person
func (p People) Len() int           { return len(p) }
func (p People) Less(i, j int) bool { return p[i].Age < p[j].Age }
func (p People) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }

sort.Sort(People(people))
```

In Go 1.21+ you would more likely use `slices.SortFunc`, but the interface
is still relevant for non-slice containers and complex multi-key sorts.

### Q16: Why are there two encoding interfaces — `TextMarshaler` and `BinaryMarshaler`?

**Answer:** They serve different formats. Text formats (JSON, XML, query
strings, env vars) consume `MarshalText() ([]byte, error)`. Binary formats
(`encoding/gob`, custom binary protocols) consume `MarshalBinary`. A type
like `time.Time` implements both — JSON uses the text form; gob uses the
binary form.

### Q17: What is the relationship between `json.Marshaler` and `encoding.TextMarshaler`?

**Answer:** `encoding/json` checks for `json.Marshaler` first. If absent, it
falls back to `TextMarshaler` and wraps the result in a JSON string. The
same precedence applies on decode. So implementing only `TextMarshaler`
gives you both `json` integration and other text-based encoders for free.

### Q18: What is the contract of `io.Closer.Close`?

**Answer:** Releases resources. Should be safe to call once. Calling Close
multiple times: behavior is implementation-defined, but the second call
typically returns an error rather than panicking. `*os.File.Close` returns
`os.ErrClosed` on the second call.

### Q19: Why is `context.Context` the **first** parameter of every IO function?

**Answer:** Convention. The `go vet` tool flags violations. It signals "this
function does work that may be canceled" and lets you wire timeouts:

```go
func Fetch(ctx context.Context, url string) ([]byte, error)
```

### Q20: How does `errors.Is` interact with custom error types?

**Answer:** It walks the chain via `Unwrap()` and compares. A custom type
can also implement `Is(target error) bool` to define its own match rules:

```go
type NotFoundErr struct{ Resource string }
func (e *NotFoundErr) Error() string { return e.Resource + " not found" }
func (e *NotFoundErr) Is(target error) bool {
    _, ok := target.(*NotFoundErr)
    return ok
}
```

---

## Senior-Level Questions

### Q21: How does `io.Pipe` use `Reader` and `Writer` together?

**Answer:** `io.Pipe` returns a `*PipeReader` and `*PipeWriter` that share a
synchronous in-memory channel. `Write` blocks until a `Read` consumes the
data. It is used to chain producers and consumers when no real file or
network connection exists — e.g. streaming a generated archive to an HTTP
response:

```go
pr, pw := io.Pipe()
go func() {
    defer pw.Close()
    zw := zip.NewWriter(pw)
    // ... add files ...
    zw.Close()
}()
io.Copy(httpRespWriter, pr)
```

### Q22: When is implementing `io.WriterTo` worth the effort?

**Answer:** When the source has a more efficient way to push bytes than
"read into a 32 KiB buffer, then write." Examples:

- The data is already a contiguous slice (e.g. `*bytes.Buffer.WriteTo`
  writes the whole slice in one call).
- The kernel can move bytes directly (`*net.TCPConn.ReadFrom` triggers
  `sendfile`).
- The producer can avoid an intermediate buffer entirely.

If you only have a Read loop anyway, do not bother — `io.Copy` will give
you the same result.

### Q23: What is wrong with this Reader implementation?

```go
func (r *MyReader) Read(p []byte) (int, error) {
    if r.done { return 0, io.EOF }
    n := copy(p, r.data)
    r.data = r.data[n:]
    if len(r.data) == 0 { r.done = true }
    return n, nil
}
```

**Answer:** It returns `(0, nil)` on the first call after exhausting the
data — between the moment `r.data` empties and the next call sets
`r.done = true`. Wait — in the code above the flag is set in the same call.
But it does not return EOF together with the last bytes. A more subtle bug
is **idempotency**: many callers expect that once `EOF` is returned, every
subsequent `Read` keeps returning `(0, EOF)`. The implementation handles
this via `r.done`, so it is fine. The real polish is to return EOF together
with the final `n`:

```go
n := copy(p, r.data)
r.data = r.data[n:]
if len(r.data) == 0 {
    r.done = true
    return n, io.EOF // pair last bytes with EOF
}
return n, nil
```

### Q24: How would you implement a graceful HTTP shutdown using context?

**Answer:**

```go
srv := &http.Server{Addr: ":8080", Handler: mux}
go srv.ListenAndServe()

<-stopSignal
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(ctx); err != nil { log.Println(err) }
```

`Shutdown` stops accepting new connections and waits for in-flight handlers
to finish. The context limits how long we wait — when the deadline elapses,
remaining connections are closed.

### Q25: How do `iter.Seq` and goroutines interact?

**Answer:** A `Seq[V]` is a function that calls `yield` synchronously. It
runs in the caller's goroutine — no concurrency by default. To bridge to a
goroutine-driven producer use `iter.Pull`:

```go
seq := iter.Seq[int](producer)
next, stop := iter.Pull(seq)
defer stop()
for {
    v, ok := next()
    if !ok { break }
    // ... use v ...
}
```

`iter.Pull` spawns a goroutine that drives the producer; `next` reads from a
channel-like primitive. `stop()` is required to release the goroutine even
if the consumer exits early.

### Q26: Why must `sql.Scanner.Scan` accept `any`?

**Answer:** The `database/sql` package converts driver-returned values into
a small set: `int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`,
`nil`. Different drivers may return slightly different concrete types for
the same column (e.g. some return `string`, others `[]byte`). Accepting
`any` lets `Scan` switch on the runtime type and handle all of them. The
mirror interface, `driver.Valuer`, returns `driver.Value` — a typed alias
of the same set.

### Q27: What is the contract failure if `Write` modifies its input slice?

**Answer:** The `io.Writer` doc says: "Write must not modify the slice data,
even temporarily." Modifying it would surprise callers who pass shared or
reused buffers — for example `bufio.Writer` might pass a slice that backs
its internal state. Even temporary modification is forbidden because the
caller's goroutine may read concurrently.

### Q28: How do you express "this stream is seekable AND readable AND closeable"?

**Answer:** Compose the interfaces in the parameter type:

```go
type ReadSeekCloser interface {
    io.Reader
    io.Seeker
    io.Closer
}
```

`io` itself defines `io.ReadSeekCloser` (Go 1.16+). The smallest possible
declaration that captures the requirement.

### Q29: How does `http.Server` use the `context.Context` of a request?

**Answer:** `http.Server` cancels the request's context when:

1. The client closes the TCP connection.
2. The server's `Shutdown` is called and the context's deadline elapses.
3. The handler returns (subsequent goroutines that captured the context
   should observe `Done` closing).

You should pass `r.Context()` into downstream calls (`db.QueryContext`,
`http.NewRequestWithContext`) so cancellation propagates.

### Q30: What is the difference between `fmt.Stringer` and `fmt.Formatter`?

**Answer:** `Stringer.String()` is a default text form. `Formatter.Format`
gets full control over verb handling — width, precision, flags, even
arbitrary verbs like `%x`. If both are implemented, `Formatter` takes
precedence for the verbs it handles; `Stringer` is the fallback. Implement
`Formatter` only when you need verb-specific output (rare); `Stringer` is
the right answer 95% of the time.

---

## Tricky / Curveball Questions

### Q31: What does this print?

```go
type T struct{ N int }
func (t T) String() string {
    return fmt.Sprintf("%v", t)
}

fmt.Println(T{42})
```

- a) `{42}`
- b) `T{N:42}`
- c) Stack overflow / panic
- d) Compile error

**Answer: c — Stack overflow.**

`String()` calls `fmt.Sprintf("%v", t)`, which invokes `String()` again,
which calls `Sprintf("%v", t)`, recursively. Fix:

```go
return fmt.Sprintf("%d", t.N)
// OR
type alias T // and convert: fmt.Sprintf("%v", alias(t))
```

### Q32: Does this implement `io.Reader`?

```go
type R struct{}
func (r R) Read(p []byte) (int, error) { return 0, io.EOF }
```

- a) Yes
- b) No
- c) Only for value receivers

**Answer: a — Yes.**

`R` has the right method set. Both `R` and `*R` satisfy `io.Reader` because
the method has a value receiver.

### Q33: What does `var x io.Reader = nil; x.Read(buf)` do?

- a) Returns `(0, io.EOF)`
- b) Returns `(0, nil)`
- c) Panics with "nil pointer dereference"
- d) Compile error

**Answer: c — Panic.**

Calling a method on a nil interface value (`itab == nil`) panics. A nil
*concrete* receiver may be safe if the method handles nil; a nil
*interface* never is.

### Q34: Will this `MarshalJSON` produce valid JSON?

```go
type T struct{ Name string }
func (t T) MarshalJSON() ([]byte, error) {
    return []byte(`{"name":` + t.Name + `}`), nil
}
```

- a) Yes
- b) No

**Answer: b — No.**

`t.Name` is not quoted nor escaped. If `Name = "Bob"` you produce
`{"name":Bob}` — invalid JSON. Use `json.Marshal(t.Name)` to encode the
string properly:

```go
buf, _ := json.Marshal(t.Name)
return []byte(`{"name":` + string(buf) + `}`), nil
```

### Q35: Why does this not implement `error`?

```go
type MyErr struct{}
func (e MyErr) error() string { return "bad" } // lowercase 'e'
```

**Answer:** The `error` interface requires the **exported** method `Error()`
with a capital E. Lowercase `error()` is a different method.

### Q36: What is wrong with this `Stringer` implementation?

```go
type ID int
func (i *ID) String() string { return fmt.Sprintf("ID-%d", *i) }

var x ID = 5
fmt.Println(x)
```

**Answer:** `String()` is on `*ID`, not `ID`. The method set of `ID`
(non-pointer) does not include `String`. `fmt.Println(x)` won't call
`String` — it prints the default int form. Pass `&x` or define on value
receiver.

### Q37: Why is this `sort.Interface` implementation broken?

```go
type Items []Item
func (a Items) Len() int           { return len(a) }
func (a Items) Less(i, j int) bool { return a[i].Score >= a[j].Score }
func (a Items) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }
```

**Answer:** `Less` uses `>=`, which is **not** a strict weak ordering — it
returns true for equal elements. `sort.Sort` may misbehave (infinite loops
in some implementations). Use `>` for descending order.

---

## Coding Tasks

### Task 1: Implement `io.Reader` for an in-memory string

```go
type StringReader struct {
    s   string
    pos int
}

func (r *StringReader) Read(p []byte) (int, error) {
    if r.pos >= len(r.s) { return 0, io.EOF }
    n := copy(p, r.s[r.pos:])
    r.pos += n
    return n, nil
}
```

### Task 2: Implement `fmt.Stringer` for a Money type

```go
type Money struct {
    Cents    int64
    Currency string
}

func (m Money) String() string {
    sign := ""
    cents := m.Cents
    if cents < 0 { sign = "-"; cents = -cents }
    return fmt.Sprintf("%s%d.%02d %s", sign, cents/100, cents%100, m.Currency)
}
```

### Task 3: Implement `json.Marshaler` with omit-empty logic

```go
type Profile struct {
    Name  string
    Bio   string  // omit when ""
    Email *string // omit when nil
}

func (p Profile) MarshalJSON() ([]byte, error) {
    out := map[string]any{"name": p.Name}
    if p.Bio != "" { out["bio"] = p.Bio }
    if p.Email != nil { out["email"] = *p.Email }
    return json.Marshal(out)
}
```

### Task 4: Implement `http.Handler` that writes a JSON response

```go
type API struct{}

func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
```

### Task 5: Implement `io.WriterTo` for a custom buffer

```go
type Buf struct{ data []byte }

func (b *Buf) WriteTo(w io.Writer) (int64, error) {
    n, err := w.Write(b.data)
    return int64(n), err
}
```

### Task 6: Implement `sort.Interface` and use `sort.Sort`

```go
type ByName []User
func (s ByName) Len() int           { return len(s) }
func (s ByName) Less(i, j int) bool { return s[i].Name < s[j].Name }
func (s ByName) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

sort.Sort(ByName(users))
```

### Task 7: Implement `context.Context`-aware long-running task

```go
func process(ctx context.Context, items []Item) error {
    for i, it := range items {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        if err := handle(it); err != nil {
            return fmt.Errorf("item %d: %w", i, err)
        }
    }
    return nil
}
```

### Task 8: Implement `error` with `Unwrap`

```go
type DBError struct {
    Op  string
    Err error
}

func (e *DBError) Error() string { return e.Op + ": " + e.Err.Error() }
func (e *DBError) Unwrap() error { return e.Err }
```

---

## System Design Style

### Q38: How would you design a streaming CSV exporter?

**Answer:** Use `http.Flusher` and `csv.Writer`:

```go
func ExportCSV(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/csv")
    flusher, _ := w.(http.Flusher)
    cw := csv.NewWriter(w)

    for row := range queryRows(r.Context()) {
        cw.Write(row)
        cw.Flush()
        if flusher != nil { flusher.Flush() }
    }
}
```

`csv.Writer.Flush` writes to the HTTP buffer; `http.Flusher.Flush` sends it
to the client. The handler respects request cancellation via the channel.

### Q39: How do you make a third-party type sortable when you cannot edit its package?

**Answer:** Define a wrapper slice type in your own package:

```go
type ByExternalScore []external.Item
func (s ByExternalScore) Len() int           { return len(s) }
func (s ByExternalScore) Less(i, j int) bool { return s[i].Score < s[j].Score }
func (s ByExternalScore) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
```

Or use `sort.Slice(items, func(i, j int) bool { ... })` with a closure — no
new type required.

### Q40: When would you implement `http.Hijacker` instead of staying with the standard handler model?

**Answer:** When the protocol upgrades away from HTTP — most commonly
WebSocket, raw TCP tunneling, or HTTP/2 protocol switching at the proxy
level. After `Hijack()` you own the TCP connection and the HTTP server no
longer manages it. Libraries like `gorilla/websocket` use it internally.

---

## What Interviewers Look For

### Junior

- Knows the four most common interfaces: `error`, `Stringer`, `Reader`, `Writer`.
- Can write a basic `Stringer` for an enum.
- Understands a method needs the right name and signature.

### Middle

- Reads doc comments to find the contract, not just the signature.
- Knows the `Read` partial-byte / EOF rule.
- Detects `WriterTo` / `ReaderFrom` optimization opportunities.
- Implements `sort.Interface` correctly (strict weak ordering).
- Correctly uses `context.Context` for cancellation.

### Senior

- Composes interfaces (`ReadCloser`, `ReadSeekCloser`).
- Uses `var _ Iface = (*T)(nil)` for compile-time assertions.
- Knows when to fall back to `Formatter` over `Stringer`.
- Understands the `MarshalJSON` precedence chain.
- Reasons about goroutine safety in interface contracts.

### Professional

- Designs library APIs around minimal interfaces ("accept interfaces, return
  structs").
- Knows when to expose optional interfaces for performance hooks.
- Mentors team on receiver-consistency and contract documentation.
- Tracks new interfaces (`iter.Seq` in 1.23) and integrates them
  thoughtfully.

---

## Cheat Sheet

```
COMMON STD-LIB INTERFACES
─────────────────────────────────────────
error              Error() string
fmt.Stringer       String() string
fmt.Formatter      Format(State, rune)
io.Reader          Read([]byte) (int, error)
io.Writer          Write([]byte) (int, error)
io.Closer          Close() error
io.Seeker          Seek(int64, int) (int64, error)
io.WriterTo        WriteTo(Writer) (int64, error)
io.ReaderFrom      ReadFrom(Reader) (int64, error)
sort.Interface     Len, Less, Swap
json.Marshaler     MarshalJSON() ([]byte, error)
encoding.TextMarsh MarshalText() ([]byte, error)
http.Handler       ServeHTTP(ResponseWriter, *Request)
http.Flusher       Flush()
http.Hijacker      Hijack() (net.Conn, *bufio.ReadWriter, error)
context.Context    Deadline, Done, Err, Value
fs.FS              Open(name) (File, error)
iter.Seq[V]        func(yield func(V) bool)
driver.Valuer      Value() (driver.Value, error)
sql.Scanner        Scan(any) error

CONTRACTS TO REMEMBER
─────────────────────────────────────────
- Read may return n>0 with err != nil — process bytes first
- Write must NOT modify p, even temporarily
- Write must return non-nil err if n<len(p)
- error string: lowercase, no period
- Less must be strict weak order
- MarshalJSON output must be valid JSON
- Close should be safe to call once; doc the second-call behavior
- context.Context is goroutine-safe; most others are NOT

DETECTION ORDER (json.Marshal)
─────────────────────────────────────────
1. json.Marshaler      → call MarshalJSON
2. encoding.TextMarsh  → wrap result in JSON string
3. reflection over struct fields & tags
```
