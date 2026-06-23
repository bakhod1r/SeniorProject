# Interface Anti-Patterns — Tasks

## Exercise structure

- 🟢 Easy 🟡 Medium 🔴 Hard 🟣 Expert

Every task gives a **bad** snippet. Identify the anti-pattern, explain why
it is bad, and rewrite it idiomatically. Solutions are at the bottom.

---

## Easy 🟢

### Task 1 — Spot the typed-nil

```go
type ParseError struct{ Pos int }
func (e *ParseError) Error() string { return fmt.Sprintf("parse error at %d", e.Pos) }
func Parse(input string) error {
    var perr *ParseError
    if input == "" { perr = &ParseError{Pos: 0} }
    return perr
}
func main() {
    if err := Parse("hello"); err != nil { log.Fatal(err) }
}
```

What does this program do, and why? Rewrite it correctly.

### Task 2 — Drop the unnecessary interface

```go
package emailer
type Mailer interface { Send(to, subject, body string) error }
type SMTPMailer struct{ host string; port int }
func (m *SMTPMailer) Send(to, subject, body string) error { /* ... */ return nil }
func New(host string, port int) Mailer { return &SMTPMailer{host: host, port: port} }
```

Refactor so the producer exports a concrete type and consumers declare
narrow interfaces.

### Task 3 — Remove getter-soup

```go
type Account interface {
    GetID() string
    SetID(string)
    GetBalance() int64
    SetBalance(int64)
    GetCreatedAt() time.Time
    SetCreatedAt(time.Time)
}
```

Replace with an idiomatic struct.

### Task 4 — Pointer-to-interface cleanup

```go
func Tee(src *io.Reader, dst1, dst2 *io.Writer) error {
    mw := io.MultiWriter(*dst1, *dst2)
    _, err := io.Copy(mw, *src)
    return err
}
```

Remove the redundant indirection.

### Task 5 — Return concrete from constructor

```go
type Cache interface {
    Get(k string) (string, bool)
    Set(k, v string)
}
type lru struct{ /* ... */ }
func (l *lru) Get(k string) (string, bool) { /* ... */ return "", false }
func (l *lru) Set(k, v string)             { /* ... */ }
func NewCache(size int) Cache { return &lru{} }
```

Make the constructor return the concrete pointer.

---

## Medium 🟡

### Task 6 — Refactor the header interface

A `Billing` interface declares 7 methods (`CreateInvoice`, `SendInvoice`,
`MarkPaid`, `RefundInvoice`, `ListInvoices`, `CountUnpaid`,
`AggregateMonthly`). The package's only impl is `service struct{ db *sql.DB }`,
returned via `func New(db *sql.DB) Billing`. Export the struct instead and
add role-specific consumer interfaces in `dunning` and `reporting`.

### Task 7 — Replace `interface{}` with generics

```go
func Contains(haystack []interface{}, needle interface{}) bool {
    for _, x := range haystack { if x == needle { return true } }
    return false
}
```

Make this generic and type-safe.

### Task 8 — Spot the io.Reader-shaped misuse

```go
type RateLimiter struct{ /* ... */ }
// Returns the current rate as marshalled JSON bytes.
func (r *RateLimiter) Read(p []byte) (int, error) { /* ... */ return 0, nil }
```

This is not a stream. Redesign the API.

### Task 9 — Eliminate mock-driven design

```go
type Clock interface { Now() time.Time }
type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }
type Service struct{ clock Clock }
func New(c Clock) *Service { return &Service{clock: c} }
```

The interface exists only so tests can mock it. Refactor to inject a
function instead.

### Task 10 — Untangle premature abstraction

```go
type GeoCoder interface { Lookup(addr string) (Coord, error) }
type googleGeo struct{}
func (googleGeo) Lookup(addr string) (Coord, error) { /* ... */ return Coord{}, nil }
// only one implementation in the codebase
```

Demote the interface to a struct unless a real second implementation exists.

### Task 11 — Decompose interface bloat

A `Storage` interface declares 13 methods: `Open`, `Close`, `Read`,
`Write`, `Truncate`, `Stat`, `List`, `Delete`, `Move`, `Copy`, `Watch`,
`Lock`, `Unlock`. Decompose into io-style small interfaces and document
who composes which.

### Task 12 — Detect and fix typed-nil through wrapping

```go
type RequestErr struct{ StatusCode int }
func (e *RequestErr) Error() string { return fmt.Sprintf("status %d", e.StatusCode) }
func Do(req *http.Request) error {
    var rerr *RequestErr
    resp, err := http.DefaultClient.Do(req)
    if err != nil { rerr = &RequestErr{StatusCode: 0}; return rerr }
    if resp.StatusCode >= 400 { rerr = &RequestErr{StatusCode: resp.StatusCode} }
    return rerr   // BUG when status < 400
}
```

Find and fix the typed-nil path.

---

## Hard 🔴

### Task 13 — Refactor a "Vehicle" hierarchy

```go
type Vehicle interface { Drive() string }
type Car struct{};        func (Car) Drive() string        { return "car drives" }
type Truck struct{};      func (Truck) Drive() string      { return "truck drives" }
type Motorcycle struct{}; func (Motorcycle) Drive() string { return "motorcycle drives" }

func PrintAll(vs []Vehicle) { for _, v := range vs { fmt.Println(v.Drive()) } }
```

`PrintAll` is the only consumer. Decide whether to keep, narrow, or delete
the abstraction. Justify your choice.

### Task 14 — Pluggable logger without mock-driven design

Design a `Service` that depends on logging without declaring a `Logger`
interface. Show how a test injects a fake.

### Task 15 — Two consumers, one producer

```go
package userrepo
type Repo struct{ db *sql.DB }
func (r *Repo) Find(ctx context.Context, id string) (*User, error)        { /* ... */ }
func (r *Repo) Save(ctx context.Context, u *User) error                   { /* ... */ }
func (r *Repo) Delete(ctx context.Context, id string) error               { /* ... */ }
func (r *Repo) List(ctx context.Context, page, size int) ([]*User, error) { /* ... */ }
```

Write `package signup` and `package admin` consumer interfaces; show how
mocks shrink vs a single shared interface.

### Task 16 — Refactor `interface{}` map handling

```go
func Lookup(data map[string]any, path ...string) (any, bool) {
    var cur any = data
    for _, p := range path {
        m, ok := cur.(map[string]any); if !ok { return nil, false }
        cur, ok = m[p];                if !ok { return nil, false }
    }
    return cur, true
}
```

Legitimate `any` (heterogeneous data); but the return forces casts at every
call site. Provide a typed companion API.

### Task 17 — Diagnose and fix a returned interface

```go
package timefn
type Now interface { Now() time.Time }
type system struct{}
func (system) Now() time.Time { return time.Now() }
func Default() Now { return system{} }   // returns interface
```

Identify all anti-patterns at play and propose a single-step refactor.

### Task 18 — Producer-side vs consumer-side mocks

Given `*UserService` with 8 methods, write a test for `signupHandler`
which uses only `Register`. Compare mock LOC in producer-side vs
consumer-side interfaces.

---

## Expert 🟣

### Task 19 — Build an API that is typed-nil safe by construction

Design a function set so that returning a typed-nil error is **impossible**
to express. Hint: unexported error types + factory returning `error`.

### Task 20 — Audit a service for all 12 anti-patterns

You inherit a 5,000-line service. Build a checklist for AP-01 through AP-12.
Show which tools (`go vet`, `staticcheck`, `gocritic`, `gopls`) help and
where human review is required.

### Task 21 — Migration plan

A library exposes `func New() Storage`. 200 downstream repos depend on it.
Plan a non-breaking migration to `func New() *FileStorage`.

### Task 22 — Generic refactor of an `any`-heavy package

Rewrite a `map[string]any` cache as `Cache[V any]`. Outline the expected
delta in `B/op` and `allocs/op` and why.

---

## Solutions

### Solution 1

`Parse("hello")` returns a non-nil interface wrapping `(*ParseError)(nil)`;
the `if err != nil` passes and `log.Fatal` runs. Fix: return `nil` literal:

```go
func Parse(input string) error {
    if input == "" { return &ParseError{Pos: 0} }
    return nil
}
```

### Solution 2

```go
package emailer
type SMTPMailer struct{ host string; port int }
func (m *SMTPMailer) Send(to, subject, body string) error { /* ... */ return nil }
func New(host string, port int) *SMTPMailer { return &SMTPMailer{host: host, port: port} }

package signup
type sender interface { Send(to, subject, body string) error }
func Welcome(s sender, email string) error { return s.Send(email, "Welcome", "Hi") }
```

### Solution 3

```go
type Account struct{ ID string; Balance int64; CreatedAt time.Time }
```

If invariants matter, hide fields and add accessors plus domain operations
like `Credit(n int64)`, not `SetBalance(n)`.

### Solution 4

```go
func Tee(src io.Reader, dst1, dst2 io.Writer) error {
    _, err := io.Copy(io.MultiWriter(dst1, dst2), src)
    return err
}
```

### Solution 5

```go
type LRU struct{ /* ... */ }
func (l *LRU) Get(k string) (string, bool) { /* ... */ }
func (l *LRU) Set(k, v string)             { /* ... */ }
func NewCache(size int) *LRU               { return &LRU{} }
```

### Solution 6

```go
package billing
type Service struct{ db *sql.DB }
func New(db *sql.DB) *Service { return &Service{db: db} }
// ... 7 concrete methods

package dunning
type unpaidLister interface {
    ListInvoices(ctx context.Context, customerID string) ([]*Invoice, error)
    CountUnpaid(ctx context.Context, customerID string) (int, error)
}

package reporting
type aggregator interface {
    AggregateMonthly(ctx context.Context, year, month int) (*Stats, error)
}
```

Each consumer's mock has 1-2 methods, not 7.

### Solution 7

```go
func Contains[T comparable](haystack []T, needle T) bool {
    for _, x := range haystack { if x == needle { return true } }
    return false
}
```

(`slices.Contains` ships since Go 1.21; for non-comparable types use a
predicate.)

### Solution 8

```go
type RateSnapshot struct{ Allowed, Remaining int; ResetAt time.Time }
func (r *RateLimiter) Snapshot() RateSnapshot { /* ... */ }
```
Reserve `Read([]byte) (int, error)` for byte streams.

### Solution 9

```go
type Service struct{ now func() time.Time }
func New() *Service { return &Service{now: time.Now} }
// test: &Service{now: func() time.Time { return time.Unix(1700000000, 0) }}
```

### Solution 10

```go
type Geo struct{ apiKey string }
func (g Geo) Lookup(addr string) (Coord, error) { /* ... */ return Coord{}, nil }
```

If a second provider lands later, the *consumer* will declare its own
interface. The producer remains struct-based.

### Solution 11

Decompose into io-style small interfaces; compose where needed:

```go
type Opener interface  { Open(name string) (Handle, error) }
type Closer interface  { Close(h Handle) error }
type ReaderAt interface{ Read(h Handle, off int64, p []byte) (int, error) }
type WriterAt interface{ Write(h Handle, off int64, p []byte) (int, error) }
type Locker interface  { Lock(name string) error; Unlock(name string) error }

type ReadOpener interface { Opener; ReaderAt; Closer }
```

### Solution 12

```go
func Do(req *http.Request) error {
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return &RequestErr{StatusCode: 0} }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 { return &RequestErr{StatusCode: resp.StatusCode} }
    return nil
}
```

### Solution 13

Move the interface to the consumer; thanks to structural typing the
vehicle types do not need to import it.

```go
package fleet
type driver interface { Drive() string }
func PrintAll(vs []driver) { for _, v := range vs { fmt.Println(v.Drive()) } }
```

### Solution 14

```go
package svc
type Service struct{ log func(format string, args ...any) }
func New() *Service { return &Service{log: log.Printf} }
// test: inject a closure that records calls
```

No `Logger` interface; the logger is just a function value.

### Solution 15

```go
package signup
type registrar interface { Save(ctx context.Context, u *User) error }

package admin
type adminAPI interface {
    Find(ctx context.Context, id string) (*User, error)
    Delete(ctx context.Context, id string) error
    List(ctx context.Context, page, size int) ([]*User, error)
}
```

`signup` mocks 1 method; `admin` mocks 3. A shared `UserRepo` would force
both to mock 4.

### Solution 16

Keep raw `Lookup` for heterogeneous JSON; add typed wrappers:

```go
func LookupString(d map[string]any, p ...string) (string, bool) {
    v, ok := Lookup(d, p...); if !ok { return "", false }
    s, ok := v.(string); return s, ok
}
func LookupInt(d map[string]any, p ...string) (int, bool) {
    v, ok := Lookup(d, p...); if !ok { return 0, false }
    n, ok := v.(int); return n, ok
}
```

### Solution 17

Anti-patterns: AP-02, AP-06, AP-07. Refactor:

```go
package timefn
func Now() time.Time { return time.Now() }
```

A package-level function is enough; consumers that need to swap inject a
`func() time.Time`.

### Solution 18

Producer-side mock requires 8 stubs (~60 LOC). Consumer-side:

```go
type registrar interface {
    Register(ctx context.Context, email, password string) (*User, error)
}
type fakeRegistrar struct{ called bool }
func (f *fakeRegistrar) Register(ctx context.Context, email, password string) (*User, error) {
    f.called = true; return &User{}, nil
}
```

~6 LOC, and only changes when this one method's signature changes.

### Solution 19

```go
package errs
type myErr struct{ msg string }
func (e *myErr) Error() string { return e.msg }
func New(msg string) error {
    if msg == "" { return nil }
    return &myErr{msg: msg}
}
```

`myErr` is unexported and the only construction path is `New`, which
returns `error`. Callers cannot build a `*myErr` directly, so a typed-nil
interface value is impossible to express.

### Solution 20

```
ANTI-PATTERN AUDIT
─────────────────────────────────────────
AP-01 typed-nil      go vet (nilness); staticcheck SA4022
AP-02 premature      count impls per iface; flag count == 1
AP-03 header iface   manual: struct methods mirrored?
AP-04 mock-driven    find -name 'mock_*'; count MockX
AP-05 setter/getter  grep '^func.*[GS]et[A-Z]'
AP-06 co-located     iface in single-impl pkg
AP-07 ret iface      'func New\w*(.*) [A-Z]\w*$'
AP-08 *interface     '\*io\.\(Reader\|Writer\|Closer\)'
AP-09 bloat          methods per iface > 5
AP-10 reader-shaped  Read([]byte) on non-stream
AP-11 any param      gopls quick-fix
AP-12 Animal OOP     manual: hierarchical naming
```

### Solution 21

Non-breaking migration:

1. Add `NewStorage() *FileStorage` alongside `New() Storage`; mark `New`
   `// Deprecated: use NewStorage`.
2. Migrate internal callers; open downstream PRs in rate-limited batches.
3. After 2 minor releases, delegate `New` to `NewStorage` and surface
   deprecation warnings.
4. Major bump (v2): remove `New` and the `Storage` interface; consumers
   declare their own narrow interfaces if needed.

### Solution 22

```go
type Cache[V any] struct{ mu sync.RWMutex; m map[string]V }
func New[V any]() *Cache[V]                  { return &Cache[V]{m: map[string]V{}} }
func (c *Cache[V]) Get(k string) (V, bool)   { c.mu.RLock(); defer c.mu.RUnlock(); v, ok := c.m[k]; return v, ok }
func (c *Cache[V]) Set(k string, v V)        { c.mu.Lock();  defer c.mu.Unlock();  c.m[k] = v }
```

`map[string]any` boxes each value into a 16-byte interface header; small
types like `int` or `time.Time` then heap-allocate per Set and increase GC
scan work. `map[string]V` stores values inline. Expected delta: B/op drops
~16+sizeof(V) per Set, allocs/op drops 1 for non-pointer V, Get avoids
type-assert cost.

---

> "Don't design with interfaces, discover them." — Rob Pike, Go Proverbs.
