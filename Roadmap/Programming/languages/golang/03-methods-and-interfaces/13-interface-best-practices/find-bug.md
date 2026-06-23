# Interface Best Practices — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

Every bug below pivots on a single broken interface-design rule. Read the
hint, try to spot the smell, then compare your reasoning against the cause
and fix sections.

---

## Bug 1 — Returning an interface when a struct fits

```go
package store

type Reader interface {
    Get(key string) ([]byte, error)
}

type fileReader struct{ path string }

func (f *fileReader) Get(key string) ([]byte, error) { /* ... */ return nil, nil }
func (f *fileReader) Stats() Stats                   { /* ... */ return Stats{} }

// NewReader is the only way callers obtain a fileReader.
func NewReader(path string) Reader {
    return &fileReader{path: path}
}
```

```go
package main

import "example.com/store"

func main() {
    r := store.NewReader("data.bin")
    s := r.Stats() // ?
    _ = s
}
```

**Hint:** What does the caller actually see?

**Bug:** The constructor returns the *interface* `store.Reader`, not the
concrete `*fileReader`. The `Stats` method exists on the concrete type but
is **not** part of `Reader`, so the caller cannot reach it. Compile error:
`r.Stats undefined (type store.Reader has no field or method Stats)`. The
guideline "accept interfaces, return structs" was inverted.

**Fix:**

```go
// Export the concrete type and return it.
type FileReader struct{ path string }

func (f *FileReader) Get(key string) ([]byte, error) { /* ... */ return nil, nil }
func (f *FileReader) Stats() Stats                   { /* ... */ return Stats{} }

func NewReader(path string) *FileReader {
    return &FileReader{path: path}
}
```

Callers who only need `Get` can still pass `*FileReader` to any function
that accepts a `Reader` interface — the interface stays on the consumer
side, where it belongs.

---

## Bug 2 — Defining the interface at the producer side

```go
package mailer

type Sender interface {
    Send(to, subject, body string) error
}

type SMTP struct{ /* ... */ }

func (s *SMTP) Send(to, subject, body string) error { /* ... */ return nil }
```

```go
package signup

import "example.com/mailer"

type Service struct {
    mail mailer.Sender // depends on the producer's interface
}

func (s *Service) Welcome(user string) error {
    return s.mail.Send(user, "Welcome", "Hi!")
}
```

**Hint:** Who decides the shape of `Sender`?

**Bug:** The interface `Sender` is declared in `mailer` (the *producer*)
and re-used by `signup` (the *consumer*). Every consumer that wants to
swap the dependency for a fake — for tests, for an alternative provider,
for a queue-backed sender — must drag in the `mailer` package and match
its full method set. The consumer cannot tailor a smaller interface to its
own needs.

**Fix:** Define the interface in the *consumer* package, narrow to what
that package actually calls.

```go
package signup

type mailSender interface {
    Send(to, subject, body string) error
}

type Service struct {
    mail mailSender // small, package-local, easy to fake
}
```

`mailer.SMTP` still satisfies it implicitly. Tests in `signup` can now
provide a one-method fake without importing `mailer`.

---

## Bug 3 — Header interface impossible to mock

```go
package storage

type Storage interface {
    Get(key string) ([]byte, error)
    Put(key string, val []byte) error
    Delete(key string) error
    List(prefix string) ([]string, error)
    Stat(key string) (Info, error)
    Copy(src, dst string) error
    Move(src, dst string) error
    Lock(key string) (Unlock, error)
    Snapshot() (Snapshot, error)
    Compact() error
    Close() error
}
```

```go
package report

type Generator struct {
    store storage.Storage // depends on the whole header
}

func (g *Generator) Run() error {
    data, err := g.store.Get("report.tmpl")
    if err != nil { return err }
    _ = data
    return nil
}
```

**Hint:** How big is the test double for `Generator`?

**Bug:** `Generator` only calls `Get`, but to test it you must implement
all eleven methods of `storage.Storage` — a "header interface" that
captures everything the implementation can do. Mocks become walls of
empty stubs and any new method on `Storage` breaks every test.

**Fix:** Depend on the smallest interface the consumer actually uses.

```go
package report

type templateFetcher interface {
    Get(key string) ([]byte, error)
}

type Generator struct {
    store templateFetcher
}
```

A test fake now has a single method. `storage.Storage` still satisfies
`templateFetcher`, but the contract at the call site is honest.

---

## Bug 4 — Missing optional capability detection

```go
package copyutil

import "io"

func CopyAll(dst io.Writer, src io.Reader) (int64, error) {
    buf := make([]byte, 32*1024)
    var total int64
    for {
        n, err := src.Read(buf)
        if n > 0 {
            m, werr := dst.Write(buf[:n])
            total += int64(m)
            if werr != nil { return total, werr }
        }
        if err == io.EOF { return total, nil }
        if err != nil    { return total, err }
    }
}
```

**Hint:** What does the standard library's `io.Copy` do that this one
does not?

**Bug:** Some readers know how to write themselves into a writer faster
than the generic loop (e.g. `*os.File` on Linux uses `sendfile`). The
standard pattern is to *probe* for an optional capability with a type
assertion and fall back when it is missing. This implementation skips
the probe and pays the buffer-copy cost every time.

**Fix:**

```go
func CopyAll(dst io.Writer, src io.Reader) (int64, error) {
    if wt, ok := src.(io.WriterTo); ok {
        return wt.WriteTo(dst)
    }
    if rf, ok := dst.(io.ReaderFrom); ok {
        return rf.ReadFrom(src)
    }
    // ... slow path identical to before
    return 0, nil
}
```

The function still accepts the small `io.Reader` / `io.Writer`
interfaces, but lets richer types opt in to a faster path.

---

## Bug 5 — Missing compile-time satisfaction check

```go
package handlers

import "net/http"

type AuthHandler struct{ /* ... */ }

// Typo: ServerHTTP instead of ServeHTTP.
func (h *AuthHandler) ServerHTTP(w http.ResponseWriter, r *http.Request) {
    // ... auth logic ...
}

// Registry stored as interface{} — http.Handler check is deferred.
var registry = map[string]any{}

func Register(path string, h any) { registry[path] = h }

func init() {
    Register("/login", &AuthHandler{}) // compiles fine
}
```

**Hint:** Where does the `http.Handler` contract get checked?

**Bug:** Because `Register` accepts `any`, the compiler never verifies
that `*AuthHandler` satisfies `http.Handler`. The misspelled `ServerHTTP`
slips past the build, and at request time the dispatcher returns 404 (or
panics on a type assertion). Without an explicit assertion in the file
that owns the type, a renamed or typo'd method silently breaks the
contract.

**Fix:** Place a compile-time check next to the type definition.

```go
type AuthHandler struct{ /* ... */ }

// Compile-time assertion: *AuthHandler must satisfy http.Handler.
var _ http.Handler = (*AuthHandler)(nil)

func (h *AuthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // ...
}
```

Now any rename or signature drift fails the build immediately, in the
file that owns the type — long before the type is laundered through
`any`.

---

## Bug 6 — Interface for a single implementation in the same package

```go
package billing

type Calculator interface {
    Total(items []Item) Money
}

type calculator struct{ taxRate float64 }

func (c *calculator) Total(items []Item) Money { /* ... */ return Money{} }

func New(taxRate float64) Calculator {
    return &calculator{taxRate: taxRate}
}
```

The package has exactly one implementation, no tests that swap it, and no
external consumer that needs to substitute it.

**Hint:** What does the interface buy you here?

**Bug:** Defining an interface "just in case" introduces indirection with
no benefit: every method call goes through a vtable, the concrete type's
extra methods are hidden, godoc shows two types instead of one, and the
abstraction lies about extensibility. Idiomatic Go interfaces appear when
*more than one implementation exists* — typically introduced from the
consumer side at that moment, not preemptively.

**Fix:**

```go
package billing

type Calculator struct{ taxRate float64 }

func (c *Calculator) Total(items []Item) Money { /* ... */ return Money{} }

func New(taxRate float64) *Calculator {
    return &Calculator{taxRate: taxRate}
}
```

If a second implementation appears later, declare a small interface in
the package that needs the swap.

---

## Bug 7 — `any` parameter where a generic would be honest

```go
package collections

// Find returns the first element for which match returns true.
func Find(items []any, match func(any) bool) any {
    for _, it := range items {
        if match(it) {
            return it
        }
    }
    return nil
}
```

```go
ages := []int{12, 17, 21, 30}
boxed := make([]any, len(ages))
for i, a := range ages { boxed[i] = a }

v := collections.Find(boxed, func(x any) bool {
    return x.(int) >= 18 // type assertion at every call
}).(int)
_ = v
```

**Hint:** What does the caller pay for `any`?

**Bug:** `any` here is a stand-in for "I gave up on types". Callers must
box every element into `[]any`, write type assertions inside the
predicate, and unbox the result. There is no real polymorphism — only one
abstract slot — which is exactly what type parameters are for. The
interface (`any` is `interface{}`) is the wrong tool: a generic function
expresses the contract precisely and removes the boxing.

**Fix (Go 1.18+):**

```go
func Find[T any](items []T, match func(T) bool) (T, bool) {
    for _, it := range items {
        if match(it) {
            return it, true
        }
    }
    var zero T
    return zero, false
}

v, ok := collections.Find(ages, func(x int) bool { return x >= 18 })
_, _ = v, ok
```

No assertions, no boxing, the compiler catches mismatches.

---

## Bug 8 — Premature abstraction blocking refactoring

```go
package pipeline

type Stage interface {
    Name() string
    Configure(map[string]string) error
    Validate() error
    Open() error
    Process(in <-chan Event, out chan<- Event) error
    Close() error
    Metrics() Metrics
}

// Only one stage exists today: *FilterStage. The interface was added
// "to keep the pipeline pluggable" before a second stage was needed.
type FilterStage struct{ /* ... */ }
```

When the team finally adds a `BatchStage`, they discover that `Configure`
should really return computed defaults, `Open` should accept a context,
and `Metrics` should be pulled instead of pushed. Every change ripples
through the interface, all callers, and all eight stub methods of the
test fake — even though only one real implementation has ever shipped.

**Hint:** Which is harder to change: a struct, or an interface its
consumers already depend on?

**Bug:** The interface was speculative. Its shape locked in assumptions
made before any second implementation existed, and now refactoring it
costs more than refactoring a struct would. The Go proverb applies: *"the
bigger the interface, the weaker the abstraction"* — and an interface
adopted before the second user is, in practice, a copy of the first
implementation's surface area.

**Fix:** Wait. Use the concrete `*FilterStage` until a real second user
appears, then *extract* the smallest interface both implementations
genuinely share. Refactoring a single struct touches one file;
refactoring an interface touches every fake and every consumer.

---

## Bug 9 — Poorly named interface (no `-er` suffix, vague intent)

```go
package report

type ReportThing interface {
    DoIt(ctx context.Context, id string) ([]byte, error)
}

func Render(rt ReportThing, id string) ([]byte, error) {
    return rt.DoIt(context.Background(), id)
}
```

**Hint:** Read the call site aloud.

**Bug:** Two related smells. (1) The interface name `ReportThing`
describes a *thing* rather than a *behavior* — Go's convention for
single-method interfaces is the action plus `-er` (`Reader`, `Stringer`,
`Closer`). (2) The method `DoIt` has no semantic content. Together they
defeat the main purpose of an interface: documenting intent at the call
site. `Render(rt, id)` reads as nonsense; future readers cannot guess
what `rt` is supposed to do without jumping to the definition.

**Fix:**

```go
type Renderer interface {
    Render(ctx context.Context, id string) ([]byte, error)
}

func Render(r Renderer, id string) ([]byte, error) {
    return r.Render(context.Background(), id)
}
```

The interface name is a noun derived from the verb, the method name
matches the action, and the call site self-documents.

---

## Bug 10 — Embedding too aggressively into a god interface

```go
package fs

type Reader interface{ Read(p []byte) (int, error) }
type Writer interface{ Write(p []byte) (int, error) }
type Closer interface{ Close() error }
type Seeker interface{ Seek(int64, int) (int64, error) }
type Stater interface{ Stat() (Info, error) }
type Locker interface{ Lock() error; Unlock() error }
type Syncer interface{ Sync() error }

// "Convenience" interface — embeds everything, used everywhere.
type File interface {
    Reader
    Writer
    Closer
    Seeker
    Stater
    Locker
    Syncer
}

func Process(f File) error { /* ... only calls Read and Close */ return nil }
```

**Hint:** What does `Process` actually need from `f`?

**Bug:** Embedding small interfaces into a single mega-type creates a
"god interface" — every consumer pays for the union of all capabilities
even when it uses one or two. Implementations must support every
embedded contract; mocks must implement seven methods to test a function
that touches two; an in-memory fake that has no `Sync` semantics is
forced to add a no-op. The composition is going the wrong direction:
small interfaces should be *embedded by callers as needed*, not
pre-aggregated by the producer.

**Fix:** Let each consumer compose what it needs.

```go
package fs

type Reader interface{ Read(p []byte) (int, error) }
type Closer interface{ Close() error }
// ... other one-method interfaces stay tiny

// Consumer composes only what it uses.
func Process(f interface {
    Reader
    Closer
}) error {
    // ...
    return nil
}
```

Or, in the consumer's own package:

```go
type readCloser interface {
    Read(p []byte) (int, error)
    Close() error
}
```

Each call site documents its real dependency, and tests need only the
methods that call site exercises.

---

## Cheat Sheet

```
INTERFACE DESIGN PITFALLS
─────────────────────────────────────────
1.  Return interface, hide concrete       → caller loses extra methods
2.  Producer-side interface               → consumer can't shape its own
3.  Header interface (10+ methods)        → mocks become walls of stubs
4.  No optional-capability probe          → miss WriterTo / ReaderFrom fast paths
5.  No compile-time `var _ I = ...`       → silent breakage on rename
6.  Interface for one impl, same package  → indirection with no payoff
7.  `any` instead of generic              → boxing + assertions everywhere
8.  Premature abstraction                 → refactor-locked, costs more later
9.  Vague name / no -er suffix            → call site reads as nonsense
10. God interface via embedding           → every consumer pays for everything

GUIDING PROVERBS
─────────────────────────────────────────
• "Accept interfaces, return structs."
• "The bigger the interface, the weaker the abstraction."
• "Don't design with interfaces — discover them."
• Interfaces belong on the consumer side, kept as small as possible.

TOOLS
─────────────────────────────────────────
go vet ./...           # interface satisfaction sanity
staticcheck ./...      # flags ineffective receivers, unused interfaces
golangci-lint run      # bundles the above + ifacecheck-style linters
```
