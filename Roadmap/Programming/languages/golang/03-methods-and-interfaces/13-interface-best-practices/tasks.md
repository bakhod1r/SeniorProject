# Interface Best Practices — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Every task asks you
to **apply** one of the best-practice rules, not just write any working
Go code.

---

## Easy 🟢

### Task 1 — Apply Postel: accept an interface, return a concrete

The function below works only on `*os.File`. Refactor so it accepts
anything that can be read, and returns a `*HashSummary` struct (your own
type with `Hex string` and `Size int64` fields).

```go
import "crypto/sha256"

// Before
func Summarize(f *os.File) (string, int64, error) {
    h := sha256.New()
    n, err := io.Copy(h, f)
    return fmt.Sprintf("%x", h.Sum(nil)), n, err
}
```

Make it usable for `*bytes.Buffer`, `*strings.Reader`, `*os.File`, and
`http.Response.Body`.

### Task 2 — Add a compile-time satisfaction check

```go
type DiskWriter struct{ path string }
func (w *DiskWriter) Write(p []byte) (int, error) { ... }
```

Add a single line that fails to compile if `*DiskWriter` ever stops
satisfying `io.Writer`.

### Task 3 — Rename to follow the `-er` convention

Rename these interfaces according to *Effective Go*:

```go
type IUserReader interface {
    Read(ctx context.Context, id string) (*User, error)
}

type DataWriterInterface interface {
    Write(ctx context.Context, data []byte) error
}

type ICloseable interface {
    Close() error
}
```

### Task 4 — Replace `any` with a concrete return

A constructor is over-abstracting. Fix it.

```go
// Before
func NewBuffer() io.Writer {
    return &bytes.Buffer{}
}
```

The caller wants to call `Buffer.String()` on the result. After your fix,
this should work:

```go
b := NewBuffer()
b.Write([]byte("hi"))
fmt.Println(b.String())   // "hi"
```

### Task 5 — Move the interface to the consumer

Below, the interface lives with the implementation. Move it to the
consumer package. Show both files.

```go
// File: userrepo/repo.go
package userrepo

type UserStore interface {
    Save(ctx context.Context, u *User) error
}

type Repo struct{ db *sql.DB }
func (r *Repo) Save(ctx context.Context, u *User) error { ... }

// File: registration/service.go
package registration

import "myapp/userrepo"

type Service struct {
    store userrepo.UserStore
}
```

---

## Medium 🟡

### Task 6 — Split a fat interface (ISP)

Decompose this into role-based interfaces. Then build a composite
`ReadWriteCloser`-style interface from the pieces.

```go
type Storage interface {
    Read(key string) ([]byte, error)
    Write(key string, value []byte) error
    Delete(key string) error
    List(prefix string) ([]string, error)
    Close() error
}
```

Hint: a read-only client should depend only on what it needs.

### Task 7 — Optional capability: `Flusher`

Write a function `WriteAndFlush(w io.Writer, p []byte)` that:

1. Writes `p` to `w`.
2. If `w` also implements an optional `Flusher` interface (`Flush() error`),
   calls `Flush()` and returns its error.

Define the `Flusher` interface yourself in the consumer file.

### Task 8 — Replace `interface{}` with a generic constraint

```go
// Before
func ContainsAny(slice []any, target any) bool {
    for _, v := range slice {
        if v == target { return true }
    }
    return false
}
```

Make it generic. The function should preserve the slice element type and
work for any comparable type.

### Task 9 — Refactor producer-side to consumer-side

Below, the abstraction is in the wrong place. Move it.

```go
// File: paymentgw/stripe.go
package paymentgw

type PaymentProvider interface {
    Charge(amount int) error
    Refund(txID string) error
}

type Stripe struct{ apiKey string }
func (s *Stripe) Charge(amount int) error { ... }
func (s *Stripe) Refund(txID string) error { ... }

// File: orders/service.go
package orders

import "myapp/paymentgw"

type Service struct{ pay paymentgw.PaymentProvider }
```

After the fix:

- `paymentgw` exports only the concrete `*Stripe`.
- `orders` defines its own minimal interface.

### Task 10 — Compose interfaces by embedding

Given:

```go
type Reader interface { Read(p []byte) (int, error) }
type Writer interface { Write(p []byte) (int, error) }
type Closer interface { Close() error }
type Flusher interface { Flush() error }
```

Build composite interfaces `ReadWriter`, `WriteCloser`, `WriteFlusher`,
and `ReadWriteCloseFlusher` by embedding.

### Task 11 — Detect `error` capabilities

Write `RootCause(err error) error` that walks `Unwrap()` to find the
deepest non-wrapping error. If the error doesn't implement `Unwrap()
error`, return it unchanged.

Use capability detection (type assertion on the optional
`interface{ Unwrap() error }`).

### Task 12 — Drop a premature interface

Below, an interface is defined for the *first* implementation, with no
second implementer in sight. Refactor to remove the interface and use
the concrete type directly. Keep a TODO comment indicating when the
interface should be re-introduced.

```go
package mailer

type Mailer interface {
    Send(to, body string) error
}

type SMTPMailer struct{ host string; port int }
func (m *SMTPMailer) Send(to, body string) error { ... }

func New(host string, port int) Mailer {
    return &SMTPMailer{host: host, port: port}
}
```

---

## Hard 🔴

### Task 13 — Apply the consumer-side rule across packages

Build a complete `cmd/app` example with three packages:

- `domain/order` — defines the `*Order` aggregate and an unexported
  consumer-side interface for whatever store it needs.
- `infra/memstore` — a concrete in-memory store with no interface
  declared.
- `main.go` — wires them together.

Show that the domain package has **no import** of the infra package.

### Task 14 — Build a capability-driven HTTP middleware

Implement a `Logging(h http.Handler) http.Handler` middleware that:

- Wraps the response writer to record bytes written and final status.
- Preserves capabilities the wrapped writer might offer: `http.Flusher`,
  `http.Hijacker`, `http.Pusher`. The wrapper must implement those
  interfaces *only when the underlying writer does*.

Hint: you'll need multiple `if _, ok := w.(...); ok` style branches and
will likely have to expose the wrapper through several alternative
constructors based on detected capabilities. Or use a type-assertion
trick at the wrapper level.

### Task 15 — Migrate to generics

This package mixes interface and `any` to support different numeric
types. Migrate to generics. Keep backward compatibility for callers
that already use the interface form by leaving a thin wrapper.

```go
package stats

type Number interface {
    Add(other any) any
    Less(other any) bool
}

func Sum(nums []Number) Number { ... }
func Min(nums []Number) Number { ... }
```

### Task 16 — `var _` checks in a library

You're maintaining a library that exports an interface `Cache`. Three
internal types are meant to satisfy it: `*memCache`, `*redisCache`, and
`*nullCache`. Add compile-time checks for all three, in the file where
the interface is defined.

```go
type Cache interface {
    Get(ctx context.Context, key string) ([]byte, bool, error)
    Set(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
}
```

### Task 17 — Replace inheritance-via-embedding with composition

Below, a `LoggedRepo` "inherits" from `Repo` via embedding, but ends up
with leaky behavior: the caller can bypass the logging layer by calling
embedded methods directly. Refactor to forced composition (no field
promotion), so the wrapper is the only path to the inner repo.

```go
type Repo struct{ db *sql.DB }
func (r *Repo) Find(id string) (*User, error) { ... }
func (r *Repo) Save(u *User) error            { ... }

type LoggedRepo struct {
    *Repo                       // embedded — methods promoted
    log *log.Logger
}
// LoggedRepo.Save and LoggedRepo.Find come from *Repo verbatim; logging
// is supposed to wrap them but doesn't.
```

### Task 18 — Build an "io.Reader gold standard" for events

Design an `events.Source` interface for a system that streams structured
events. Apply every best practice: small interface, optional capabilities,
consumer-side definition, generic where appropriate.

Requirements:

- Base: a `Next(ctx) (Event, error)` method, with `io.EOF` on stream end.
- Optional: a `Seeker` (`SeekTo(offset int64)`).
- Optional: a `Snapshotter` (`Snapshot() ([]byte, error)`).
- The package shouldn't predefine concrete implementations.

---

## Expert 🟣

### Task 19 — Hexagonal architecture for an order service

Build a complete hexagonal architecture for an order service:

- `domain/order` — aggregate, ports.
- `infra/postgres` — `OrderRepo` adapter.
- `infra/email` — `Mailer` adapter.
- `infra/payments/stripe` — `Charger` adapter.
- `app/checkout` — use case orchestrator (consumer of all ports).
- `cmd/api` — HTTP layer; wires everything.

Verify:

- No infra package imports any other infra package.
- `app/checkout` imports only `domain/order` and standard libraries.
- Every interface lives where it's consumed.
- Adapters return concrete structs from constructors.

### Task 20 — Backward-compatible interface evolution

You ship a library with:

```go
package store
type Storer interface {
    Get(k string) (string, error)
    Set(k, v string) error
}
```

A new version needs `SetIfAbsent(k, v string) (bool, error)` — atomic
conditional write. Implementations that don't support atomicity should
keep working without modification.

Design the evolution. Write:

1. The new optional interface.
2. A `Write(s Storer, k, v string)` helper that uses the fast path when
   available and falls back otherwise.
3. A migration note explaining the rule for callers and implementers.

### Task 21 — Refactor `interface{}` SOAP-style API to typed ports

A legacy package wraps every external call as an `interface{}`-shaped
RPC. Refactor to typed Go interfaces with role-based names.

```go
type RPC interface {
    Call(method string, args interface{}, reply interface{}) error
}
```

The known methods are: `User.Get(id) -> User`, `User.Save(u) -> nil`,
`Order.Place(req) -> OrderID`. Define typed interfaces and a typed
adapter that wraps the legacy `RPC`.

### Task 22 — Plugin loader with capability detection

Build a plugin loader (compile-time, not `plugin` package) where each
plugin is a Go type registered in `init()`. The loader supports:

- A required `Plugin` interface: `Name() string`, `Version() string`.
- An optional `Initializer`: `Init(ctx) error`.
- An optional `Configurable`: `Configure(opts map[string]any) error`.
- An optional `HTTPHandler`: `Handler() http.Handler`.

The loader iterates registered plugins, calls each capability if the
plugin implements it, and assembles a single `http.Handler` from those
that implement `HTTPHandler`.

---

## Solutions

### Solution 1

```go
import (
    "crypto/sha256"
    "fmt"
    "io"
)

type HashSummary struct {
    Hex  string
    Size int64
}

func Summarize(r io.Reader) (*HashSummary, error) {
    h := sha256.New()
    n, err := io.Copy(h, r)
    if err != nil {
        return nil, err
    }
    return &HashSummary{
        Hex:  fmt.Sprintf("%x", h.Sum(nil)),
        Size: n,
    }, nil
}

// Usage examples (Postel: accept any io.Reader):
// _, _ = Summarize(strings.NewReader("hi"))
// _, _ = Summarize(bytes.NewReader(data))
// f, _ := os.Open("file.txt"); defer f.Close(); _, _ = Summarize(f)
// resp, _ := http.Get(url); defer resp.Body.Close(); _, _ = Summarize(resp.Body)
```

### Solution 2

```go
type DiskWriter struct{ path string }
func (w *DiskWriter) Write(p []byte) (int, error) { return 0, nil }

var _ io.Writer = (*DiskWriter)(nil)
```

### Solution 3

```go
type UserReader interface {
    Read(ctx context.Context, id string) (*User, error)
}

type DataWriter interface {
    Write(ctx context.Context, data []byte) error
}

type Closer interface {
    Close() error
}
```

No `I` prefix, no `Interface` suffix; method-name plus `-er`.

### Solution 4

```go
import "bytes"

func NewBuffer() *bytes.Buffer {
    return &bytes.Buffer{}
}

// Caller now has full access to *bytes.Buffer's method set,
// including String(), Len(), Bytes(), etc.
```

### Solution 5

```go
// File: userrepo/repo.go
package userrepo

type Repo struct{ db *sql.DB }
func (r *Repo) Save(ctx context.Context, u *User) error { return nil }

// no interface declared here

// File: registration/service.go
package registration

type userStore interface {                       // unexported, consumer-defined
    Save(ctx context.Context, u *User) error
}

type Service struct{ store userStore }

func New(s userStore) *Service { return &Service{store: s} }

// main.go wires:
// reg := registration.New(userrepo.New(db))     // *Repo satisfies userStore
```

### Solution 6

```go
type Reader   interface { Read(key string) ([]byte, error) }
type Writer   interface { Write(key string, value []byte) error }
type Deleter  interface { Delete(key string) error }
type Lister   interface { List(prefix string) ([]string, error) }
type Closer   interface { Close() error }

type ReadWriter interface { Reader; Writer }
type Storage    interface { Reader; Writer; Deleter; Lister; Closer }

// A read-only consumer:
type cacheLoader struct{ store Reader }   // depends on one method only
```

### Solution 7

```go
package writer

import "io"

type flusher interface {
    Flush() error
}

func WriteAndFlush(w io.Writer, p []byte) error {
    if _, err := w.Write(p); err != nil {
        return err
    }
    if f, ok := w.(flusher); ok {
        return f.Flush()
    }
    return nil
}
```

### Solution 8

```go
func ContainsAny[T comparable](slice []T, target T) bool {
    for _, v := range slice {
        if v == target {
            return true
        }
    }
    return false
}

// ContainsAny([]int{1, 2, 3}, 2)        → true
// ContainsAny([]string{"a", "b"}, "c")  → false
```

### Solution 9

```go
// File: paymentgw/stripe.go
package paymentgw

type Stripe struct{ apiKey string }
func (s *Stripe) Charge(amount int) error    { return nil }
func (s *Stripe) Refund(txID string) error   { return nil }

// no interface — concrete only

// File: orders/service.go
package orders

type charger interface {                       // consumer-defined
    Charge(amount int) error
}

type Service struct{ pay charger }

// main.go:
// ord := orders.New(paymentgw.NewStripe(apiKey))
```

### Solution 10

```go
type ReadWriter interface {
    Reader
    Writer
}

type WriteCloser interface {
    Writer
    Closer
}

type WriteFlusher interface {
    Writer
    Flusher
}

type ReadWriteCloseFlusher interface {
    Reader
    Writer
    Closer
    Flusher
}
```

### Solution 11

```go
func RootCause(err error) error {
    type unwrapper interface {
        Unwrap() error
    }
    for {
        u, ok := err.(unwrapper)
        if !ok {
            return err
        }
        next := u.Unwrap()
        if next == nil {
            return err
        }
        err = next
    }
}
```

### Solution 12

```go
package mailer

// TODO: extract a Mailer interface when a second implementation
// (e.g. SES, SendGrid, mock for tests) appears. Until then, returning
// the concrete struct keeps callers free to use *SMTPMailer's full
// method set.

type SMTPMailer struct {
    host string
    port int
}

func New(host string, port int) *SMTPMailer {
    return &SMTPMailer{host: host, port: port}
}

func (m *SMTPMailer) Send(to, body string) error {
    return nil
}
```

### Solution 13

```go
// domain/order/order.go
package order

import "context"

type Order struct {
    ID    string
    Items []string
}

type repository interface {                      // consumer-defined, unexported
    Save(ctx context.Context, o *Order) error
    Find(ctx context.Context, id string) (*Order, error)
}

type Service struct{ repo repository }

func NewService(repo repository) *Service { return &Service{repo: repo} }

func (s *Service) Place(ctx context.Context, items []string) (*Order, error) {
    o := &Order{ID: "ord-1", Items: items}
    return o, s.repo.Save(ctx, o)
}

// infra/memstore/store.go
package memstore

import (
    "context"
    "sync"

    "myapp/domain/order"
)

type Store struct {
    mu sync.Mutex
    m  map[string]*order.Order
}

func New() *Store { return &Store{m: map[string]*order.Order{}} }

func (s *Store) Save(_ context.Context, o *order.Order) error {
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[o.ID] = o
    return nil
}
func (s *Store) Find(_ context.Context, id string) (*order.Order, error) {
    s.mu.Lock(); defer s.mu.Unlock()
    return s.m[id], nil
}

// cmd/app/main.go
package main

import (
    "context"

    "myapp/domain/order"
    "myapp/infra/memstore"
)

func main() {
    svc := order.NewService(memstore.New())
    _, _ = svc.Place(context.Background(), []string{"book"})
}
```

The `domain/order` package does NOT import `infra/memstore`. Structural
typing connects them.

### Solution 14

```go
package middleware

import (
    "bufio"
    "net"
    "net/http"
)

type tracker struct {
    http.ResponseWriter
    status, written int
}

func (t *tracker) WriteHeader(code int) {
    t.status = code
    t.ResponseWriter.WriteHeader(code)
}
func (t *tracker) Write(p []byte) (int, error) {
    if t.status == 0 { t.status = http.StatusOK }
    n, err := t.ResponseWriter.Write(p)
    t.written += n
    return n, err
}

// Optional capabilities forwarded only when the underlying writer
// supports them. We expose them all on *tracker but assert at call time.
func (t *tracker) Flush() {
    if f, ok := t.ResponseWriter.(http.Flusher); ok {
        f.Flush()
    }
}
func (t *tracker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
    if h, ok := t.ResponseWriter.(http.Hijacker); ok {
        return h.Hijack()
    }
    return nil, nil, http.ErrNotSupported
}
func (t *tracker) Push(target string, opts *http.PushOptions) error {
    if p, ok := t.ResponseWriter.(http.Pusher); ok {
        return p.Push(target, opts)
    }
    return http.ErrNotSupported
}

func Logging(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        t := &tracker{ResponseWriter: w}
        h.ServeHTTP(t, r)
        log.Printf("%s %s %d %d", r.Method, r.URL.Path, t.status, t.written)
    })
}
```

(For pixel-perfect capability preservation in production, use a runtime
type-switch to construct a wrapper that *only* implements the
capabilities the underlying writer actually has — a more advanced
technique used by `gorilla/handlers` and `chi`'s middleware.)

### Solution 15

```go
package stats

import "cmp"

func Sum[T cmp.Ordered](nums []T) T {
    var total T
    for _, n := range nums {
        total += n            // requires T to support +; cmp.Ordered does for numerics+strings
    }
    return total
}

func Min[T cmp.Ordered](nums []T) T {
    if len(nums) == 0 {
        var zero T
        return zero
    }
    m := nums[0]
    for _, n := range nums[1:] {
        if n < m { m = n }
    }
    return m
}
```

For backward compatibility, leave the old API as a wrapper marked
deprecated:

```go
// Deprecated: use Sum[T cmp.Ordered] directly.
type Number interface {
    intLike
}
```

### Solution 16

```go
package cache

import "context"

type Cache interface {
    Get(ctx context.Context, key string) ([]byte, bool, error)
    Set(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
}

// Compile-time satisfaction guarantees.
var (
    _ Cache = (*memCache)(nil)
    _ Cache = (*redisCache)(nil)
    _ Cache = (*nullCache)(nil)
)

type memCache   struct{ /* ... */ }
type redisCache struct{ /* ... */ }
type nullCache  struct{}
```

If any of the three drops a method, compilation breaks immediately.

### Solution 17

```go
type Repo struct{ db *sql.DB }
func (r *Repo) Find(id string) (*User, error) { return nil, nil }
func (r *Repo) Save(u *User) error            { return nil }

type LoggedRepo struct {
    inner *Repo                                 // explicit composition
    log   *log.Logger
}

func NewLoggedRepo(r *Repo, l *log.Logger) *LoggedRepo {
    return &LoggedRepo{inner: r, log: l}
}

func (l *LoggedRepo) Find(id string) (*User, error) {
    l.log.Printf("Find(%s)", id)
    return l.inner.Find(id)
}

func (l *LoggedRepo) Save(u *User) error {
    l.log.Printf("Save(%v)", u)
    return l.inner.Save(u)
}
```

Now there is no field promotion — callers can't reach `inner.Find`
directly because `inner` is unexported. Logging is the only path.

### Solution 18

```go
package events

import (
    "context"
    "io"
)

// Base: minimal contract.
type Event struct {
    ID   string
    Body []byte
}

type Source interface {
    Next(ctx context.Context) (Event, error)   // io.EOF when stream ends
}

// Optional capabilities — only implementers that support them satisfy these.
type Seeker interface {
    SeekTo(offset int64) error
}

type Snapshotter interface {
    Snapshot() ([]byte, error)
}

// Helper that opportunistically uses Seeker if available.
func RewindAndDrain(s Source) ([]Event, error) {
    if sk, ok := s.(Seeker); ok {
        if err := sk.SeekTo(0); err != nil {
            return nil, err
        }
    }
    var out []Event
    for {
        e, err := s.Next(context.Background())
        if err == io.EOF { return out, nil }
        if err != nil    { return out, err }
        out = append(out, e)
    }
}
```

The package exports only interfaces. Concrete implementations live in
adapter packages (`events/file`, `events/kafka`, `events/memory`, etc.)
and return concrete structs.

### Solution 19 (sketch)

```go
// domain/order/order.go
package order
type repository interface { Save(...) error; Find(...) (*Order, error) }
type charger    interface { Charge(amount int) error }
type mailer     interface { Send(to, body string) error }

type Service struct{ repo repository; pay charger; mail mailer }

// infra/postgres/order_repo.go
package postgres
type OrderRepo struct{ db *sql.DB }
func (r *OrderRepo) Save(...) error { return nil }
func (r *OrderRepo) Find(...) (*order.Order, error) { return nil, nil }

// infra/email/smtp.go
package email
type SMTP struct{ host string }
func (s *SMTP) Send(to, body string) error { return nil }

// infra/payments/stripe/charger.go
package stripe
type Charger struct{ apiKey string }
func (c *Charger) Charge(amount int) error { return nil }

// app/checkout/usecase.go
package checkout
type repository interface { /* same shape as domain/order */ }
type Charger    interface { Charge(amount int) error }
type Mailer     interface { Send(to, body string) error }

func Place(repo repository, pay Charger, mail Mailer, items []string) error {
    // orchestration ...
    return nil
}

// cmd/api/main.go
func main() {
    repo := postgres.New(db)
    pay  := stripe.New(apiKey)
    mail := email.New(smtpHost)
    handler := api.NewHandler(repo, pay, mail)
    http.ListenAndServe(":8080", handler)
}
```

Each infra package is import-isolated. The domain depends on no infra.
The wiring lives only in `cmd/api`.

### Solution 20

```go
package store

// Existing — unchanged, never break.
type Storer interface {
    Get(k string) (string, error)
    Set(k, v string) error
}

// New optional capability — non-breaking addition.
type ConditionalStorer interface {
    Storer
    SetIfAbsent(k, v string) (stored bool, err error)
}

// Helper picks fast path opportunistically.
func WriteIfAbsent(s Storer, k, v string) error {
    if cs, ok := s.(ConditionalStorer); ok {
        _, err := cs.SetIfAbsent(k, v)
        return err
    }
    if _, err := s.Get(k); err == nil {
        return nil   // assume key exists; non-atomic fallback
    }
    return s.Set(k, v)
}
```

**Migration note:**

- Implementers who can do atomic conditional writes may add
  `SetIfAbsent`. Existing implementations need no change.
- Callers that need atomicity should depend on `ConditionalStorer`
  directly. Callers that don't can keep using `Storer` and
  `WriteIfAbsent`.

### Solution 21

```go
package legacy

type RPC interface {
    Call(method string, args, reply interface{}) error
}

// Typed ports defined where consumers live.
package users

type Getter interface {
    Get(id string) (*User, error)
}
type Saver interface {
    Save(u *User) error
}

// Adapter wraps the legacy RPC into typed methods.
type RPCAdapter struct{ rpc legacy.RPC }

func (a *RPCAdapter) Get(id string) (*User, error) {
    var u User
    if err := a.rpc.Call("User.Get", id, &u); err != nil {
        return nil, err
    }
    return &u, nil
}
func (a *RPCAdapter) Save(u *User) error {
    var ack struct{}
    return a.rpc.Call("User.Save", u, &ack)
}

// Compile-time guarantees:
var (
    _ Getter = (*RPCAdapter)(nil)
    _ Saver  = (*RPCAdapter)(nil)
)
```

Each consumer of typed interfaces stays type-safe; only the adapter
deals with `interface{}`.

### Solution 22

```go
package plugins

import (
    "context"
    "net/http"
    "sync"
)

type Plugin interface {
    Name() string
    Version() string
}

type Initializer interface {
    Init(ctx context.Context) error
}

type Configurable interface {
    Configure(opts map[string]any) error
}

type HTTPHandler interface {
    Handler() http.Handler
}

var (
    mu       sync.Mutex
    registry = map[string]Plugin{}
)

func Register(p Plugin) {
    mu.Lock(); defer mu.Unlock()
    registry[p.Name()] = p
}

func Boot(ctx context.Context, cfg map[string]map[string]any) (http.Handler, error) {
    mux := http.NewServeMux()
    for name, p := range registry {
        if c, ok := p.(Configurable); ok {
            if err := c.Configure(cfg[name]); err != nil {
                return nil, err
            }
        }
        if init, ok := p.(Initializer); ok {
            if err := init.Init(ctx); err != nil {
                return nil, err
            }
        }
        if h, ok := p.(HTTPHandler); ok {
            mux.Handle("/"+name+"/", http.StripPrefix("/"+name, h.Handler()))
        }
    }
    return mux, nil
}
```

Each capability is an independent interface. A plugin author opts in by
implementing the methods they care about. The loader composes
behavior at runtime via type assertion.

---

## Cheat Sheet — Quick Reference

```
DESIGN-TIME RULES
──────────────────────────────────────────────
  ✓ Accept interface, return struct
  ✓ Define interface in consumer package
  ✓ One method when possible, two acceptable
  ✓ Name with -er suffix; no I prefix
  ✓ Compose interfaces via embedding
  ✓ Add capabilities as separate optional interfaces

REVIEW-TIME RULES
──────────────────────────────────────────────
  ✓ var _ I = (*T)(nil) for cross-package types
  ✗ Don't return interfaces from constructors
  ✗ Don't define interfaces with one consumer in same pkg
  ✗ Don't pre-design — discover instead
  ✗ Don't aggregate unrelated methods (ISP violation)
  ✗ Don't return typed nil

WHEN TO PICK A GENERIC CONSTRAINT
──────────────────────────────────────────────
  ✓ Closed type set
  ✓ Need to preserve concrete return type
  ✓ Hot loop, zero-cost abstraction required
  ✗ Open type set with runtime polymorphism
  ✗ Mixing types in slice/map
```
