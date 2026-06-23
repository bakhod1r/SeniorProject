# Interface Best Practices — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Composition Over Inheritance — Architectural View](#composition-over-inheritance-architectural-view)
3. [Library API Design — The Public Surface](#library-api-design-the-public-surface)
4. [Generic Constraints vs Traditional Interfaces](#generic-constraints-vs-traditional-interfaces)
5. [Interface Stability and Backward Compatibility](#interface-stability-and-backward-compatibility)
6. [The "Single Method Family" Pattern](#the-single-method-family-pattern)
7. [Decorator and Middleware Through Embedding](#decorator-and-middleware-through-embedding)
8. [Interface as Boundary Between Modules](#interface-as-boundary-between-modules)
9. [Optional-Interface Probes in Real Code](#optional-interface-probes-in-real-code)
10. [Constraining Behavior, Not Types](#constraining-behavior-not-types)
11. [Concurrency Contracts in Interface Docs](#concurrency-contracts-in-interface-docs)
12. [Naming at Library Scale](#naming-at-library-scale)
13. [Reading the Standard Library Critically](#reading-the-standard-library-critically)
14. [Summary](#summary)

---

## Introduction

At the senior level, interface design becomes architectural. Each interface you publish is an obligation: implementers depend on its shape and consumers depend on its semantics. The senior question is no longer "should this be an interface?" but "what does this interface allow me to evolve, and what does it forbid?"

This file focuses on the *positive* design moves: composition, generic-vs-interface choice, public-API stability, and the patterns that let `io.Reader`, `http.Handler`, and `sort.Interface` keep paying dividends 15 years after they were defined.

---

## Composition Over Inheritance — Architectural View

Go has no inheritance. Composition is the only tool for "X-is-also-Y" relationships, and interfaces are the cleanest expression of it.

### Three composition mechanics

```go
// 1. Interface embedding — declarative
type ReadWriter interface {
    io.Reader
    io.Writer
}

// 2. Struct embedding satisfying interfaces — implicit
type LoggingFile struct {
    *os.File           // *os.File methods promoted; LoggingFile satisfies io.Reader, io.Writer, ...
    log *log.Logger
}

// 3. Functional adapter — type with one method
type HandlerFunc func(w http.ResponseWriter, r *http.Request)
func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) { h(w, r) }
```

All three are composition. The senior choice is to pick the **least powerful** mechanism that fits — a function adapter beats a struct, a struct beats embedding, embedding beats explicit forwarding.

### Architectural payoff

Layers communicate through small embedded interfaces, not concrete types. Replacing one layer becomes a one-line wiring change. The dependency graph stays acyclic by construction.

```
domain   (defines small interfaces it needs)
   ▲
   │
service  (orchestrates; takes interfaces by parameter)
   ▲
   │
adapters (satisfy interfaces; sit at the edge)
```

Inheritance hierarchies tangle because they encode "is-a" relationships forever. Composition through interfaces only encodes "right now this is what I need".

---

## Library API Design — The Public Surface

Every exported interface in a library is part of its semver contract. Senior library authors aim for the **smallest** public surface that supports the use cases.

### Canonical pattern — return concrete, accept interface

```go
// Public — concrete return so users get the full API
func New(cfg Config) *Client { ... }

// Methods on the concrete type
func (c *Client) Do(req *Request) (*Response, error)
func (c *Client) Close() error
```

Users who want to abstract over the client can declare their own interface against `*Client`'s method set:

```go
// In their consumer package
type Doer interface {
    Do(*http.Request) (*http.Response, error)
}
```

`*http.Client` already satisfies that interface, even though `net/http` does not export it. Same with `net.Conn`, `*sql.DB`, and many others. The library does not need to predict every consumer abstraction; small consumer-side interfaces fall out automatically.

### When the library MUST publish interfaces

- When the library is a *framework* expecting plug-ins (`http.Handler`, `image.Image`)
- When the same operation has fundamentally different implementations the library can ship (`hash.Hash`, `crypto/cipher.Block`)
- When the library expresses a runtime polymorphism point (`sort.Interface`)

In those cases the interface lives next to the *abstract concept*, not next to one implementation.

### Library-author rules of thumb

1. Default to no exported interface. Ship a struct.
2. If a second implementation appears, *then* extract.
3. Each new exported interface is a one-way door — choose deliberately.
4. The interface should be useful with the implementations the library already ships.

---

## Generic Constraints vs Traditional Interfaces

Go 1.18+ added generics, which use interface-like *type sets* as constraints. The senior question: when to use a constraint, when to use a runtime interface?

### Use a generic constraint when…

- The operation is **type-preserving** (e.g., `Map[T, U]`)
- You want **zero-cost abstraction** (no itab dispatch, no boxing)
- The implementation is the same code regardless of type
- All implementations are known at compile time

```go
type Number interface {
    ~int | ~int64 | ~float64
}

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs { total += x }
    return total
}
```

### Use a traditional interface when…

- Implementations carry **state** or **side effects**
- You want **runtime polymorphism** (different impls behind the same call)
- The number of implementations is open-ended
- Mocking and dependency injection matter

```go
type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}
```

### Hybrid example

```go
// Generic builder; constraint expresses behavior, dispatch is static.
type Encoder[T any] interface {
    Encode(T) ([]byte, error)
}

func WriteAll[T any, E Encoder[T]](w io.Writer, enc E, items []T) error {
    for _, it := range items {
        b, err := enc.Encode(it)
        if err != nil { return err }
        if _, err := w.Write(b); err != nil { return err }
    }
    return nil
}
```

Here the *function* is generic for performance, and `io.Writer` stays an old-style runtime interface because writers are inherently stateful.

### Decision matrix

| Question | Answer | Choose |
|----------|--------|--------|
| Are implementations finite and known? | yes | constraint |
| Need to mock for tests? | yes | runtime interface |
| Are you optimising a hot loop? | yes | constraint |
| Is the type set bounded by behavior, not value? | yes | runtime interface |
| Does the operation return a `T`? | yes | constraint |

---

## Interface Stability and Backward Compatibility

Adding a method to an exported interface is a **breaking change**. Consumers who implemented the old interface stop compiling. Senior authors design with this constraint in mind.

### Three additive evolution patterns

**Pattern A — Embed and create a new sibling**

```go
// Original
type Reader interface {
    Read(p []byte) (int, error)
}

// New, additive
type ReadCloser interface {
    Reader
    Close() error
}
```

`Reader` users keep working; `ReadCloser` users get more. No one breaks.

**Pattern B — Optional capability via type assertion**

```go
// Optional richer cousin
type WriterTo interface {
    WriteTo(w Writer) (int64, error)
}

func Copy(dst Writer, src Reader) (int64, error) {
    if wt, ok := src.(WriterTo); ok { return wt.WriteTo(dst) }
    // fallback
}
```

Consumers that never satisfy `WriterTo` continue to work; those that do unlock a fast path.

**Pattern C — Versioned package path**

For genuinely new shapes, ship `mypkg/v2`. Go modules treat it as a separate import. Each major version retains stable interfaces.

### What NEVER to do

- Add a method to an exported interface.
- Change a method signature.
- Rename a method.
- Tighten a documented contract.

These all break implementers.

### Loosening the contract

Loosening — accepting more inputs, returning more general errors — is generally safe but should still ship in a minor version with a clear changelog note.

---

## The "Single Method Family" Pattern

Think of `io.Reader` not as a one-off interface but as the *root of a family*. The whole `io` package is built this way:

```
Reader, Writer, Closer            (1 method each)
    │
    ├─► ReadCloser, WriteCloser   (2 methods, embedded)
    ├─► ReadWriter                (2 methods, embedded)
    ├─► ReadWriteCloser           (3 methods, embedded)
    │
ReaderAt, WriterAt                (random access)
ByteReader, ByteWriter            (byte-by-byte)
ReaderFrom, WriterTo              (optional fast paths)
StringWriter                      (optional, no []byte alloc)
```

Each member is **one method** plus optional embeddings. There is no `IO` mega-interface anywhere.

### Apply to your domain

```go
// One-method roots
type Validator interface { Validate() error }
type Sanitizer interface { Sanitize() }
type Auditor   interface { Audit(ctx context.Context, ev Event) }

// Compositions appear only when needed
type ValidatorSanitizer interface {
    Validator
    Sanitizer
}
```

The pattern enforces ISP automatically: every consumer depends on exactly the small interface it needs.

---

## Decorator and Middleware Through Embedding

A senior staple: wrap a value behind the same interface, augmenting behavior without disturbing callers.

### Repository decorator

```go
type UserRepo interface {
    Find(ctx context.Context, id UserID) (*User, error)
    Save(ctx context.Context, u *User) error
}

type cachingRepo struct {
    UserRepo                          // embed; Find/Save default to inner
    cache *lru.Cache[UserID, *User]
}

func NewCaching(inner UserRepo, size int) *cachingRepo {
    return &cachingRepo{UserRepo: inner, cache: lru.New[UserID, *User](size)}
}

// Override Find — Save still falls through to the embedded inner
func (r *cachingRepo) Find(ctx context.Context, id UserID) (*User, error) {
    if u, ok := r.cache.Get(id); ok { return u, nil }
    u, err := r.UserRepo.Find(ctx, id)
    if err == nil { r.cache.Add(id, u) }
    return u, err
}
```

By embedding `UserRepo`, `cachingRepo` automatically satisfies the interface. Only the methods you intentionally override are written. The pattern stacks: `LoggingRepo(MetricsRepo(CachingRepo(PgRepo)))`.

### HTTP middleware

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}
```

`http.Handler` is one method, so middleware composition is trivial.

### Senior takeaway

Embedding turns "wrap and forward" from boilerplate into a one-liner. Keep the wrapped interface small, and you get an unlimited decorator stack for free.

---

## Interface as Boundary Between Modules

Every interface defines a **contract boundary**. Senior architects use that to separate stable from volatile code.

### Inside the boundary — concrete types

```go
package billing

// Internal types are concrete. They can change freely.
type invoice struct { ... }
type lineItem struct { ... }
```

### At the boundary — small interface

```go
package billing

// Public boundary; consumers depend only on this.
type Service interface {
    CreateInvoice(ctx context.Context, customer CustomerID) (InvoiceID, error)
    Settle(ctx context.Context, id InvoiceID) error
}
```

The implementation of `Service` can be rewritten end-to-end without breaking any caller, as long as the contract stays. Conversely, callers can be tested without the real billing engine.

### Architectural tip

Treat the interface file as immutable infrastructure. Code reviews on the interface get extra scrutiny; code reviews on the implementation are routine.

---

## Optional-Interface Probes in Real Code

The senior pattern: design every required interface so it can grow optional capabilities later.

### Standard library probes — pattern study

```go
// io.Copy
if wt, ok := src.(WriterTo); ok {
    return wt.WriteTo(dst)
}

// http server — Server-Sent Events
if f, ok := w.(http.Flusher); ok {
    f.Flush()
}

// http server — WebSocket upgrade
if h, ok := w.(http.Hijacker); ok {
    conn, buf, err := h.Hijack()
    ...
}
```

Each probe asks: *do you happen to support this richer behavior?* If yes, fast path. If no, fallback path.

### Designing your own

```go
// Required
type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}

// Optional — implementations that support pattern eviction
type Patterner interface {
    DeletePattern(pattern string) error
}

func invalidateUserList(c Cache) {
    if p, ok := c.(Patterner); ok {
        p.DeletePattern("user-list:*")
    }
    // else: rely on TTL
}
```

### Rule for senior reviewers

If a function has `if x, ok := v.(Richer); ok { ... }`, that should:
- Live in **the same package** as `Richer`'s declaration (so you control the probe rule)
- Be documented in the godoc of the *required* interface
- Have a sane fallback that always works

---

## Constraining Behavior, Not Types

Senior interface design names the *behavior* a caller needs. The interface should not leak any concrete type's identity.

```go
// Bad — leaks implementation
type RedisCache interface {
    Get(key string) ([]byte, error)
    Conn() *redis.Conn          // ⚠ exposes redis
}

// Good
type Cache interface {
    Get(key string) ([]byte, error)
}
```

If the consumer ever needs a `*redis.Conn`, they should not hide it behind a generic `Cache`. Either:
- Use the concrete `*RedisCache` directly (and accept the dependency), or
- Wrap the redis-specific need behind another small interface (`type ConnReleaser interface { Release() }`).

### The corollary — interfaces should be testable with a fake

If the smallest reasonable fake for `Cache` ends up holding a `*redis.Conn`, the interface is broken. Re-shape it.

---

## Concurrency Contracts in Interface Docs

Interface documentation must speak about concurrency. Without it, implementers and consumers make incompatible assumptions.

### Standard-library examples

- `*sql.DB` is documented as safe for concurrent use.
- `*bytes.Buffer` is documented as **not** safe.
- `http.Handler.ServeHTTP` says "Handlers should read the body fully before returning"; absence of mention implies the *server* may call ServeHTTP from many goroutines.

### Recipe for your own interfaces

```go
// Cache stores small bytes blobs keyed by string.
//
// All methods are safe for concurrent use by multiple goroutines.
// Implementations may use internal locking; callers do not need to
// synchronise externally. Get returns ok=false (not an error) for a
// cache miss; Set never returns an error and overwrites silently.
type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}
```

### Why this is senior work

Concurrency mismatches are some of the hardest production bugs. Documenting "must hold a lock around every call" *in the interface* prevents an entire class of deadlocks at the boundary.

---

## Naming at Library Scale

In a library that exports many interfaces, naming becomes design.

### Tiers of naming

| Tier | Convention | Example |
|------|-----------|---------|
| Single method | `Verber` | `Reader`, `Closer`, `Encoder` |
| Two methods, related verbs | `VerbAndVerb` or composite | `ReadWriter` |
| Pure capability marker | adjective | `Stringer` (returns `String`) |
| Domain role | role noun | `Repository`, `Handler`, `Service` |

### Avoid colliding with package name

`storage.Storage` is awkward (`storage.Storage`, `storage.NewStorage`). Pick a better noun: `storage.Repo`, `storage.Bucket`.

### Avoid `Type` suffix

`type EncoderType interface {}` adds nothing. The Go reader knows it is a type from the `type` keyword.

### Avoid `I` prefix

`IEncoder`, `IReader`. Hungarian style; un-Go.

---

## Reading the Standard Library Critically

Seniors learn interface design by *reading* `io`, `net/http`, `sort`, `database/sql`, and `crypto/cipher`. Concrete observations:

- `io.Reader` doc is a lesson in defensive contract specification.
- `net/http.Handler` shows how a one-method interface drives an entire framework.
- `sort.Interface` is the canonical "swap-able collection" abstraction.
- `database/sql.Driver` exposes a **family** of small interfaces (`Conn`, `Stmt`, `Rows`) — each driver implements them; the high-level `*sql.DB` wraps the family.
- `crypto/cipher.Block` and `Stream` are tiny composable interfaces; `BlockMode` builds on them.

**Exercise:** for one library you maintain, redesign the interface set in the spirit of `database/sql/driver`. The result is almost always smaller and more orthogonal.

---

## Summary

Senior interface practice is design discipline:

1. **Composition over inheritance** — embed small interfaces, never inherit big ones.
2. **Library APIs** — concrete return values, consumer-side small interfaces; only export interfaces when polymorphism is the abstract concept.
3. **Generic constraints vs traditional interfaces** — constraint for type-preserving compile-time work, interface for runtime state.
4. **Stability** — never add a method; embed, sibling, or version.
5. **Single method family** — grow capability via embedding and optional probes.
6. **Decorator/middleware through embedding** — wrap and forward becomes one line.
7. **Behavior, not type** — interfaces must hide implementation identity.
8. **Concurrency contract** — the doc says it explicitly.
9. **Reading the std lib** — `io`, `net/http`, `database/sql/driver` are the playbook.

If your interface design lets you replace the implementation tomorrow without changing the call sites, you got it right.
