# Common Interfaces — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [API Boundaries: Accept Interfaces, Return Structs](#api-boundaries-accept-interfaces-return-structs)
3. [Layered Systems Built on Std-Lib Interfaces](#layered-systems-built-on-std-lib-interfaces)
4. [Streaming Architecture with `io.Reader`/`io.Writer`](#streaming-architecture-with-ioreaderiowriter)
5. [HTTP Stack Composition](#http-stack-composition)
6. [Context Discipline at Scale](#context-discipline-at-scale)
7. [Testing via Interface Boundaries](#testing-via-interface-boundaries)
8. [Versioning and Contract Stability](#versioning-and-contract-stability)
9. [Production Anti-Patterns](#production-anti-patterns)
10. [Tooling and CI Gates](#tooling-and-ci-gates)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Introduction

At the professional level the std-lib interfaces become the **language of architecture**. Rather than inventing project-specific abstractions, mature Go codebases reuse `io.Reader`, `io.Writer`, `http.Handler`, `context.Context`, `fs.FS`, and `iter.Seq` because these interfaces are already understood by every Go programmer and every existing library.

This page covers the design decisions that come with that choice: where to draw boundaries, how to keep the public surface stable, how to compose layered systems, and how to test through these interface seams.

---

## API Boundaries: Accept Interfaces, Return Structs

The Go community condenses years of API wisdom into one rule:

> **Accept interfaces, return concrete types.**

```go
// Accept the smallest interface that captures what you need.
func Encode(w io.Writer, v any) error

// Return a concrete type — callers can use its full method set.
func NewBuffer() *bytes.Buffer
```

### Why?

- **Caller flexibility.** A function that takes `io.Writer` accepts `*os.File`, `*bytes.Buffer`, `*gzip.Writer`, `http.ResponseWriter` — anything.
- **Future evolution.** If you return an interface, you can never add a new method without breaking implementations. If you return a struct, callers who need a wider behavior just call additional methods.
- **Predictability.** Concrete types document themselves — the godoc shows every available method.

### Example: a logging helper

```go
// Bad — narrows callers and forces them to satisfy *Logger.
func WriteRequest(l *Logger, r *http.Request) error { ... }

// Good — accept any Writer.
func WriteRequest(w io.Writer, r *http.Request) error { ... }

// Compose at the call site.
WriteRequest(myLogger, req)
WriteRequest(os.Stdout, req)
WriteRequest(&buf, req)
```

The function body never needs to know what `w` is — and neither does the caller.

---

## Layered Systems Built on Std-Lib Interfaces

A typical production Go service has layers, and each layer's contract is a std-lib interface or a tiny custom one built from std-lib pieces.

```
┌──────────────────────────────────────────────────────┐
│  HTTP edge        http.Handler                       │
├──────────────────────────────────────────────────────┤
│  Middleware       func(http.Handler) http.Handler    │
├──────────────────────────────────────────────────────┤
│  Application      service.Service{Repo, Bus, ...}    │
├──────────────────────────────────────────────────────┤
│  Domain           types implementing Stringer,       │
│                   error, json.Marshaler              │
├──────────────────────────────────────────────────────┤
│  Persistence      sql.DB / driver.Valuer / Scanner  │
├──────────────────────────────────────────────────────┤
│  Storage edge     fs.FS, io.Reader, io.WriteCloser   │
└──────────────────────────────────────────────────────┘
```

### Domain types implement the std-lib interfaces

```go
// User is a domain entity — implements Stringer, json.Marshaler/Unmarshaler.
type User struct {
    ID    UserID
    Name  string
    Email string
}

func (u User) String() string {
    return fmt.Sprintf("User(%s, %s)", u.ID, u.Name)
}

func (u User) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        ID    string `json:"id"`
        Name  string `json:"name"`
        Email string `json:"email,omitempty"`
    }{string(u.ID), u.Name, u.Email})
}
```

Logging, JSON encoding, and SQL persistence all flow through these interfaces. A new transport (gRPC, GraphQL, message queue) doesn't need a custom encoder — it reuses the same JSON or text marshaler.

### The persistence layer wraps `database/sql`

```go
type UserRepo interface {
    Find(ctx context.Context, id UserID) (*User, error)
    Save(ctx context.Context, u *User) error
}

type pgUserRepo struct{ db *sql.DB }

func (r *pgUserRepo) Find(ctx context.Context, id UserID) (*User, error) {
    var u User
    err := r.db.QueryRowContext(ctx, "SELECT id, name, email FROM users WHERE id=$1", id).
        Scan(&u.ID, &u.Name, &u.Email)
    if err != nil {
        return nil, err
    }
    return &u, nil
}
```

`UserID` implements `sql.Scanner` and `driver.Valuer` so it round-trips with no boilerplate. The repo signature uses **only** std-lib types in the public API.

### Storage edge uses `fs.FS`

```go
type ConfigLoader struct {
    fsys fs.FS
}

func (l *ConfigLoader) Load(name string) (Config, error) {
    data, err := fs.ReadFile(l.fsys, name)
    if err != nil {
        return Config{}, err
    }
    var c Config
    return c, json.Unmarshal(data, &c)
}

// Tests pass a fstest.MapFS; production passes os.DirFS("/etc/myapp")
```

The same loader runs against an `embed.FS` for development, `os.DirFS` for production, and `fstest.MapFS` for tests.

---

## Streaming Architecture with `io.Reader`/`io.Writer`

Real services move bytes — file uploads, JSON streams, log shipping, video transcoding. Designing those pipelines in terms of `io.Reader` and `io.Writer` keeps memory bounded.

### Pipeline: HTTP upload → gzip → write to storage

```go
func upload(w http.ResponseWriter, r *http.Request) {
    defer r.Body.Close()

    out, err := storage.Create(r.Context(), r.URL.Path)
    if err != nil { http.Error(w, err.Error(), 500); return }
    defer out.Close()

    gz := gzip.NewWriter(out)        // gzip wraps the storage writer
    defer gz.Close()

    if _, err := io.Copy(gz, r.Body); err != nil {  // ← single io.Copy call
        http.Error(w, err.Error(), 500)
        return
    }
    w.WriteHeader(http.StatusCreated)
}
```

Memory used by this pipeline: the gzip window (~32 KiB) plus the I/O buffer in `io.Copy`. The body could be 100 GB — it streams through.

### Pipeline: JSON stream → transform → DB

```go
func ingest(ctx context.Context, src io.Reader, repo UserRepo) error {
    dec := json.NewDecoder(src)
    if _, err := dec.Token(); err != nil { // opening [
        return err
    }
    for dec.More() {
        var u User
        if err := dec.Decode(&u); err != nil {
            return err
        }
        if err := repo.Save(ctx, &u); err != nil {
            return err
        }
    }
    return nil
}
```

Streaming decoder — never materializes the whole array.

### Boundary types carry the contract

When designing a library that does I/O, expose:
- An `io.Reader` for input.
- An `io.Writer` for output.
- A `context.Context` parameter for cancellation.
- A `func(...) (io.WriteCloser, error)` factory that returns the concrete type.

That signature is instantly understood by every Go programmer.

---

## HTTP Stack Composition

`net/http` is built around `http.Handler`. Production services compose handlers like Lego.

```go
func chain(h http.Handler, mws ...func(http.Handler) http.Handler) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}

handler := chain(
    apiRouter,
    requestID,        // injects an ID into ctx
    timeout(30*time.Second),
    metrics,
    recoverPanic,
    cors,
)
http.ListenAndServe(":8080", handler)
```

### Each middleware is a `Handler`-to-`Handler` function

```go
func timeout(d time.Duration) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx, cancel := context.WithTimeout(r.Context(), d)
            defer cancel()
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

The request's context flows through automatically. Downstream handlers see the deadline; SQL drivers and HTTP clients respect it.

### Streaming responses use `http.Flusher`

```go
func sse(w http.ResponseWriter, r *http.Request) {
    fl, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming not supported", 500)
        return
    }
    w.Header().Set("Content-Type", "text/event-stream")
    enc := json.NewEncoder(w)
    for ev := range events {
        if r.Context().Err() != nil {
            return
        }
        fmt.Fprintf(w, "data: ")
        _ = enc.Encode(ev)
        fmt.Fprint(w, "\n")
        fl.Flush()
    }
}
```

Two std-lib interfaces (`http.Flusher`, `context.Context`) and one optional behavior detection — that's the entire blueprint.

### `http.Pusher` (HTTP/2 server push)

```go
if pusher, ok := w.(http.Pusher); ok {
    pusher.Push("/static/app.js", nil)
    pusher.Push("/static/app.css", nil)
}
```

Same probe pattern. Production serves see this everywhere.

---

## Context Discipline at Scale

`context.Context` is famously easy to misuse. Professional standards:

### Rule 1: First parameter, always

```go
// GOOD
func (s *Service) Find(ctx context.Context, id ID) (*User, error)

// BAD
func (s *Service) Find(id ID, ctx context.Context) (*User, error)
```

CI lints reject the second form (`contextcheck`).

### Rule 2: Don't store contexts in structs

```go
// BAD
type Worker struct {
    ctx context.Context  // antipattern
}

// GOOD
type Worker struct{}
func (w *Worker) Run(ctx context.Context) { ... }
```

Storing a context binds it to the lifetime of the struct, defeating the cancellation chain.

### Rule 3: Always derive child contexts

```go
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel()
```

Forgetting `defer cancel()` leaks the timer. `go vet -lostcancel` catches this.

### Rule 4: Don't use ctx.Value for required parameters

```go
// BAD
func (s *Service) Find(ctx context.Context) (*User, error) {
    id := ctx.Value(userIDKey).(string)  // hidden contract
}

// GOOD
func (s *Service) Find(ctx context.Context, id string) (*User, error)
```

`ctx.Value` is for **request-scoped, optional** metadata (request ID, trace span, auth principal). Use a custom key type, never a string.

### Rule 5: Plumb context all the way down

If your `Repo.Save(ctx, u)` calls a queue, the queue publish must also take `ctx`. If your hash function loops a million times, give it a `ctx.Err()` check:

```go
for i := range items {
    if i%1024 == 0 {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
    }
    ...
}
```

godoc: <https://pkg.go.dev/context>

---

## Testing via Interface Boundaries

Std-lib interfaces are excellent test seams.

### Test through `io.Reader`/`io.Writer`

```go
func TestEncode(t *testing.T) {
    var buf bytes.Buffer
    if err := Encode(&buf, payload); err != nil {
        t.Fatal(err)
    }
    if got := buf.String(); got != want {
        t.Errorf("got %q, want %q", got, want)
    }
}
```

No mocks needed — `*bytes.Buffer` is a full `io.Writer`.

### Test through `fs.FS` with `fstest.MapFS`

```go
import "testing/fstest"

func TestLoadConfig(t *testing.T) {
    fsys := fstest.MapFS{
        "config.json": &fstest.MapFile{Data: []byte(`{"port":8080}`)},
    }
    loader := &ConfigLoader{fsys: fsys}
    cfg, err := loader.Load("config.json")
    // ...
}
```

The loader doesn't know it's being tested. Production code is unchanged.

### Test through `http.Handler` with `httptest`

```go
func TestHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/users/1", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != 200 {
        t.Errorf("status = %d", rec.Code)
    }
}
```

Std-lib interfaces are the API; std-lib helpers are the test infrastructure.

### Mock dependencies as small interfaces

```go
type Notifier interface {
    Notify(ctx context.Context, user UserID, msg string) error
}

type Service struct {
    notifier Notifier
}

// Test
type fakeNotifier struct{ sent []string }
func (f *fakeNotifier) Notify(_ context.Context, _ UserID, msg string) error {
    f.sent = append(f.sent, msg)
    return nil
}
```

Notice: **the interface is declared on the consumer side**, not in the library that provides the implementation. This keeps each package's public surface small.

---

## Versioning and Contract Stability

Once a public function takes `io.Reader`, you can't change the parameter type without a breaking release. But you can:

### Add new fast-path interfaces

```go
// v1
func Process(r io.Reader) error

// v1.1 — internally probes for io.WriterTo
func Process(r io.Reader) error {
    if wt, ok := r.(io.WriterTo); ok {
        // fast path
    }
    // existing slow path
}
```

Non-breaking. Callers passing a richer type get a speedup; callers with a basic Reader still work.

### Add new methods on returned struct types

```go
func New() *Client { ... }

// v1.1 — add Client.Stats() — new method, non-breaking.
func (c *Client) Stats() Stats { ... }
```

If you'd returned an interface in v1, this would be impossible.

### Avoid changing receiver types

Going from `(c Client)` to `(c *Client)` changes the method set — it is a breaking change at the interface satisfaction level. Pick once, stick with it.

### Deprecate, don't remove

```go
// Deprecated: use NewClient.
func New() *Client { return NewClient() }
```

`staticcheck` warns callers; you keep the old API alive for one major version.

---

## Production Anti-Patterns

### Anti-pattern: returning a wide interface

```go
// BAD
func NewStore(...) Store { return &diskStore{} }

type Store interface {
    Get(id ID) ([]byte, error)
    Put(id ID, data []byte) error
    List() ([]ID, error)
    Stats() Stats
    Compact() error
    // 12 more methods
}
```

A "Store" interface this wide can never be implemented by anyone but you. Return `*diskStore` directly; callers can pin a smaller interface in their own code.

### Anti-pattern: leaking implementation through optional probes

```go
// BAD — caller must know to type-assert.
func New() io.Writer { return &myWriter{} }

// elsewhere
w := New()
if mw, ok := w.(*myWriter); ok {  // implementation detail leaked
    mw.SetTimeout(5*time.Second)
}
```

If `SetTimeout` is part of the contract, expose it on the returned concrete type (`*myWriter`).

### Anti-pattern: unbounded `bytes.Buffer` for streaming

```go
// BAD — buffers entire body in memory.
var buf bytes.Buffer
io.Copy(&buf, r.Body)
process(buf.Bytes())

// GOOD — streams.
process(r.Body)  // process accepts io.Reader
```

### Anti-pattern: discarding errors from `Close`

```go
// BAD
defer w.Close()

// GOOD — at least log.
defer func() {
    if err := w.Close(); err != nil {
        log.Printf("close: %v", err)
    }
}()
```

For writers, `Close` is when buffers are flushed and errors surface. Discarding it loses the last-mile error.

### Anti-pattern: sentinel error explosion

```go
// BAD
var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")
var ErrTimeout  = errors.New("timeout")
// ... 30 more
```

Use a small sentinel set plus typed errors that wrap them. Callers use `errors.Is`/`errors.As`.

---

## Tooling and CI Gates

### `go vet`
- `lostcancel` — `context.WithCancel` returned but cancel never called.
- `httpresponse` — body not closed.
- `unreachable` — nonsense after `os.Exit`.

### `staticcheck`
- `SA1006` — `errors.New(fmt.Sprintf(...))` should be `fmt.Errorf`.
- `SA4017` — using a `Reader` after error.
- `S1004` — `Read` should return as soon as `n>0` is meaningful.

### `errcheck`
Catches `_ = file.Close()` patterns where the error matters.

### `contextcheck`
Detects functions that should propagate context but don't.

### `gosec`
Flags `ioutil.ReadAll(unboundedReader)` as a potential memory exhaustion vector.

### Custom analyzers
Use `golang.org/x/tools/go/analysis` to enforce project rules (e.g. "every public method that does I/O must take a context.Context").

---

## Cheat Sheet

```
API DESIGN RULES
─────────────────────────────────
Accept interfaces, return structs
Smallest interface that captures the need
Caller-side interfaces > library-side
Concrete return → future method additions are non-breaking

LAYER MAP
─────────────────────────────────
HTTP       http.Handler, http.HandlerFunc, http.Flusher
Service    custom small interfaces (Repo, Bus)
Domain     Stringer, error, json.Marshaler, Valuer/Scanner
Storage    io.Reader, io.Writer, fs.FS, io.Closer
Stream     io.Pipe, io.Copy with WriterTo/ReaderFrom

CONTEXT DISCIPLINE
─────────────────────────────────
First param, always
Never store in struct
defer cancel()
ctx.Value only for request-scoped metadata
Plumb all the way down

VERSIONING
─────────────────────────────────
Add optional fast-path interfaces — non-breaking
Add methods to returned struct — non-breaking
Change receiver T↔*T — BREAKING
Change parameter or return type — BREAKING
Deprecate, don't remove

ANTI-PATTERNS
─────────────────────────────────
Wide library-side interfaces
Buffering streamable input
Ignoring Close errors
Sentinel error explosion
ctx.Value as required parameter
```

---

## Summary

Professional Go uses the std-lib interfaces as a **vocabulary**:

1. **Accept interfaces, return structs** — every layer becomes pluggable.
2. **Streaming everywhere** — `io.Reader`/`io.Writer` keep memory bounded.
3. **Compose middleware** — `http.Handler` plus `func(Handler) Handler` builds entire HTTP stacks.
4. **Discipline `context.Context`** — first param, never stored, always plumbed.
5. **Test through std-lib interfaces** — `*bytes.Buffer`, `httptest.NewRecorder`, `fstest.MapFS`.
6. **Plan for evolution** — concrete return types, additive method changes, deprecation cycles.
7. **Enforce rules with linters** — `go vet`, `staticcheck`, `errcheck`, `contextcheck`.

These habits compound: each small interface choice becomes a fixed point that the rest of the system can rely on, year after year.
