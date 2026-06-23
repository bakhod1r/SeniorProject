# Interface Best Practices — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap of the Junior Rules](#recap-of-the-junior-rules)
3. [Consumer-Side Definition in Practice](#consumer-side-definition-in-practice)
4. [Compile-Time Satisfaction Patterns](#compile-time-satisfaction-patterns)
5. [Capability Detection via Type Assertion](#capability-detection-via-type-assertion)
6. [Optional Interfaces](#optional-interfaces)
7. [Documenting Contracts Properly](#documenting-contracts-properly)
8. [Versioning — When to Add a Method](#versioning-when-to-add-a-method)
9. [Embedding for Composition](#embedding-for-composition)
10. [Testing Around Small Interfaces](#testing-around-small-interfaces)
11. [Case Study — `io.Reader` Family](#case-study-ioreader-family)
12. [Case Study — `http.Handler` Pipeline](#case-study-httphandler-pipeline)
13. [Practical Refactor — From Big to Small](#practical-refactor-from-big-to-small)
14. [Code Review Checklist](#code-review-checklist)
15. [Tricky Questions](#tricky-questions)
16. [Summary](#summary)

---

## Introduction

At the middle level you already know that interfaces should be small and named with the `-er` suffix. Now we tighten the rules and add the patterns that show up in real packages:

- **Consumer-side definition** in larger projects with clean dependency graphs
- **Compile-time satisfaction checks** as a safety net
- **Optional interfaces** — the standard library's recipe for adding capability without breaking API
- **Documentation** strong enough to be actionable

Each section below is centered on what *to do*. The mirror-image — what to avoid — lives in `14-interface-anti-patterns`.

---

## Recap of the Junior Rules

| Rule | Practical effect |
|------|------------------|
| Small interfaces | More implementers, easier mocks |
| `-er` suffix | Behavior-first naming |
| Accept interfaces, return concrete types | Maximum caller flexibility |
| Define at consumer site | No reverse dependencies |
| `var _ I = (*T)(nil)` | Compile-time guarantee |
| Embed to compose | Build up from `Reader`/`Writer` |
| Document the contract | Behavior, errors, concurrency, optional sub-interfaces |

If any of those feel uncertain, re-read the junior file before continuing.

---

## Consumer-Side Definition in Practice

The "interfaces are declared by the consumer" rule has a concrete mechanical consequence: **the consumer's package never needs to import the implementer's package**.

### Without the rule (reverse dependency)

```
service ──► storage         service imports storage to get UserRepo
storage ──► database/sql    storage holds the interface AND the impl
```

Now `storage` is on the import path of every consumer that wants to mock the database. Refactoring the storage package or splitting it is invasive.

### With the rule

```
service                 service declares its own UserLookup interface
storage ──► sql         storage exposes a concrete *PgUserRepo
main    ──► service, storage     main wires them together
```

The dependency graph flows in one direction. Tests in `service` need only a tiny fake; the fake doesn't import anything from `storage` either.

### Code

```go
// File: service/notifier.go
package service

import "context"

// userLookup is unexported because only this package needs to know
// about the abstraction. The implementing struct lives elsewhere.
type userLookup interface {
    FindUser(ctx context.Context, id string) (*User, error)
}

type Notifier struct {
    users  userLookup
    sender Sender
}

func (n *Notifier) Notify(ctx context.Context, userID, msg string) error {
    u, err := n.users.FindUser(ctx, userID)
    if err != nil {
        return err
    }
    return n.sender.Send(ctx, u.Email, msg)
}
```

```go
// File: storage/pg_user.go
package storage

import (
    "context"
    "database/sql"
)

type PgUserRepo struct{ db *sql.DB }

func NewPgUserRepo(db *sql.DB) *PgUserRepo { return &PgUserRepo{db: db} }

func (r *PgUserRepo) FindUser(ctx context.Context, id string) (*User, error) {
    // SQL query
}
```

```go
// File: main.go
package main

func main() {
    db := openDB()
    repo := storage.NewPgUserRepo(db)
    n := service.NewNotifier(repo, sender) // *PgUserRepo satisfies service.userLookup implicitly
    n.Notify(ctx, "u1", "hello")
}
```

The `service` package never imports `storage`. The `storage` package never imports `service`. The composition root in `main` is the only place that knows both.

### Tip — keep the interface unexported when only one package uses it

If the interface is purely a service-internal abstraction, lowercase its name. If multiple consumers need it, export it.

---

## Compile-Time Satisfaction Patterns

The basic pattern is:

```go
var _ io.Reader = (*MyReader)(nil)
```

There are three placement strategies, each with a use case.

### Strategy 1 — next to the type

```go
type Buffer struct{ data []byte }
func (b *Buffer) Read(p []byte) (int, error)  { ... }
func (b *Buffer) Write(p []byte) (int, error) { ... }

var (
    _ io.Reader = (*Buffer)(nil)
    _ io.Writer = (*Buffer)(nil)
)
```

Use this when the type is **intended** to satisfy the listed interfaces. Anyone removing a method gets an immediate compile error.

### Strategy 2 — in tests

```go
// File: buffer_test.go
package buffer

func TestImplementsIO(t *testing.T) {
    var _ io.Reader = (*Buffer)(nil)
    var _ io.Writer = (*Buffer)(nil)
}
```

Same effect, but kept out of the production binary. Some teams prefer this for "soft" contracts.

### Strategy 3 — in the consumer package

```go
package service

// Production wiring should compile only if PgUserRepo satisfies userLookup.
var _ userLookup = (*storage.PgUserRepo)(nil)
```

Less common, but useful when a downstream package wants to assert the upstream type still fits.

### What the pattern does NOT do

It does **not**:
- run at runtime
- allocate
- prevent someone from removing the type entirely

It only confirms: *as of this build, this concrete type implements the interface.* That alone catches a lot of refactoring mistakes.

---

## Capability Detection via Type Assertion

A core idiom in the Go standard library: accept the smallest interface, but **upgrade if the value also satisfies a richer one**. The pattern is a one-line type assertion.

```go
func Copy(dst io.Writer, src io.Reader) (int64, error) {
    // Fast path: src might know how to write itself directly.
    if wt, ok := src.(io.WriterTo); ok {
        return wt.WriteTo(dst)
    }
    // Fast path: dst might know how to read directly.
    if rf, ok := dst.(io.ReaderFrom); ok {
        return rf.ReadFrom(src)
    }
    // Slow path: byte-by-byte
    return genericCopy(dst, src)
}
```

This is `io.Copy`'s real shape. Most callers think of it as "Reader → Writer", but `*os.File`-to-`*os.File` triggers `ReaderFrom`/`WriterTo` to skip the user-space buffer.

### Best practice

When designing an interface, leave room for **optional** richer cousins:

```go
// Required for everyone
type Encoder interface {
    Encode(v any) error
}

// Optional — fast path for streams that can flush
type Flusher interface {
    Flush() error
}

func process(enc Encoder) error {
    if err := enc.Encode(payload); err != nil { return err }
    if f, ok := enc.(Flusher); ok {
        return f.Flush()
    }
    return nil
}
```

Implementers who add a `Flush` method automatically get the fast path; those who don't, still work. **No breaking change.**

---

## Optional Interfaces

This is the named pattern that builds on capability detection. The standard library uses it everywhere: `io.WriterTo`, `io.ReaderFrom`, `io.StringWriter`, `http.Hijacker`, `http.Pusher`, `http.Flusher`.

### Recipe

1. Define the **required** interface as the minimum.
2. Define a separate **optional** interface that adds one capability.
3. Inside your code, type-assert and dispatch.

### Concrete example — caching with optional invalidation

```go
type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}

type Invalidator interface {
    Invalidate(key string)
}

func updateUser(c Cache, u User) {
    c.Set(u.ID, serialize(u))
    if inv, ok := c.(Invalidator); ok {
        inv.Invalidate("user-list") // bonus: bust the list
    }
}
```

A simple in-memory cache may skip `Invalidate`; a Redis-backed cache that can flush patterns implements it. The consumer code still works in both worlds.

### Where the standard library applies it

| Required | Optional | Effect |
|----------|----------|--------|
| `io.Reader` | `io.WriterTo` | Stream copy without intermediate buffer |
| `io.Writer` | `io.ReaderFrom` | Same, other direction |
| `io.Writer` | `io.StringWriter` | Avoids `[]byte(s)` conversion |
| `http.ResponseWriter` | `http.Flusher` | Server-sent events |
| `http.ResponseWriter` | `http.Hijacker` | WebSocket upgrade |
| `http.ResponseWriter` | `http.Pusher` | HTTP/2 push |

The `ResponseWriter` family in particular is a master class: a single small required interface, plus discoverable upgrades depending on the underlying server.

---

## Documenting Contracts Properly

A godoc on an interface is part of the API. It tells implementers what they may rely on and what they must guarantee.

### Checklist for an interface doc

1. **What the operation means semantically** (not just "what the method does")
2. **Argument constraints** ("p must be non-nil", "ctx must not be nil")
3. **Error conventions** ("returns ErrClosed if Close has been called")
4. **Concurrency** ("safe for concurrent use" or "must not be called concurrently")
5. **Optional related interfaces** ("if this also implements Flusher, ...")
6. **Lifetime / ownership** ("the caller must Close the returned Reader")

### Template

```go
// Sender delivers messages to a single recipient.
//
// Send is safe for concurrent use. It returns nil only after the
// underlying transport has acknowledged receipt. The provided context
// must not be nil; Send must respect ctx.Done() and return ctx.Err()
// promptly. Implementations that batch messages may also satisfy
// Flusher; callers should look for that interface to force delivery.
type Sender interface {
    Send(ctx context.Context, m Message) error
}
```

### Real-world model

Read the doc on `io.Reader` once a year; it is famously precise about edge cases (`n > 0` with non-nil error, `0, nil` is permitted but discouraged, etc.). That level of clarity is what enables thousands of types to interoperate.

---

## Versioning — When to Add a Method

Adding a method to an exported interface is a **breaking change**. Every existing implementer that does not have that method stops compiling. So how does the standard library evolve interfaces?

### Strategy 1 — never modify; create a sibling interface

```go
// v1, frozen
type Encoder interface {
    Encode(v any) error
}

// v2, additive
type FlushEncoder interface {
    Encoder
    Flush() error
}
```

Consumers that need `Flush` ask for `FlushEncoder`. Implementers that don't have one are unaffected.

### Strategy 2 — optional interface (Practice 8)

If only some implementers will provide the new behavior, add it as an *optional* interface and detect via type assertion. No existing code breaks.

### Strategy 3 — embed and extend

The new interface embeds the old:

```go
type ReaderV2 interface {
    Reader
    ReadAt(p []byte, off int64) (int, error)
}
```

Any function that used to take a `Reader` keeps working. Functions that need the new capability ask for `ReaderV2`.

### When IS adding a method OK?

Only when:
- The interface is unexported, OR
- The interface is in a v0/internal-only package, OR
- You are willing to release a major version bump

### CodeReviewComments: "small interfaces are easier to extend"

The smaller the original interface, the smaller the chance you ever need to "add" anything. You build up via composition or optional interfaces.

---

## Embedding for Composition

Embedding is the idiomatic way to express "an interface that is also another interface". It is **declarative** and produces no extra method-set juggling.

### Building up

```go
type Reader interface { Read(p []byte) (int, error) }
type Closer interface { Close() error }

type ReadCloser interface {
    Reader
    Closer
}
```

A function that needs both:

```go
func consume(rc io.ReadCloser) error {
    defer rc.Close()
    _, err := io.Copy(io.Discard, rc)
    return err
}
```

### Embedding existing interfaces from another package

```go
type AuthHandler interface {
    http.Handler          // ServeHTTP from net/http
    Authenticator         // local interface
}
```

Anyone who already implements `http.Handler` only needs to add `Authenticate`.

### Avoiding accidental signature mismatches

Since Go 1.14, embedding two interfaces that both declare the same method with **identical** signature is allowed. If signatures differ — compile error. The lesson: embed deliberately, and keep method names unique across orthogonal capabilities.

---

## Testing Around Small Interfaces

A consumer-side small interface makes testing painless.

### Production code

```go
package billing

type ChargeAPI interface {
    Charge(ctx context.Context, customerID string, cents int) (TxID, error)
}

type Service struct {
    api ChargeAPI
}

func (s *Service) Renew(ctx context.Context, sub Subscription) error {
    _, err := s.api.Charge(ctx, sub.Customer, sub.Price)
    return err
}
```

### Test fake

```go
type fakeAPI struct {
    calls []int
    err   error
}

func (f *fakeAPI) Charge(_ context.Context, _ string, cents int) (TxID, error) {
    f.calls = append(f.calls, cents)
    return "tx-fake", f.err
}

func TestRenew_Success(t *testing.T) {
    f := &fakeAPI{}
    s := &Service{api: f}
    if err := s.Renew(ctx, Subscription{Customer: "c1", Price: 999}); err != nil {
        t.Fatal(err)
    }
    if got := f.calls; len(got) != 1 || got[0] != 999 {
        t.Fatalf("want one call of 999, got %v", got)
    }
}
```

The fake is six lines. If `ChargeAPI` had ten methods, the fake would be ten times longer and full of `panic("unexpected call")` stubs. **Small interfaces pay for themselves on the first test.**

### Tip — keep mocks hand-written when small

Code-generated mocks (mockery, gomock) make sense for big interfaces, but for one or two methods a hand-written fake reads better and is easier to debug.

---

## Case Study — `io.Reader` Family

Look at how the standard library extends `io.Reader` without ever changing it:

```go
type Reader interface {
    Read(p []byte) (int, error)
}

// Optional — efficient stream-to-stream copy
type WriterTo interface {
    WriteTo(w Writer) (int64, error)
}

// Optional — supports random access
type ReaderAt interface {
    ReadAt(p []byte, off int64) (int, error)
}

// Optional — supports peeking without consuming
type ByteReader interface {
    ReadByte() (byte, error)
}

// Optional — explicit close ownership
type ReadCloser interface {
    Reader
    Closer
}
```

Every extension is its own one-method interface, *embedded* or *detected*. After 15 years, `Reader` itself has never gained a method. That is the ultimate proof of "small interfaces win".

---

## Case Study — `http.Handler` Pipeline

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

One method. Now look at what `ResponseWriter` enables:

```go
type ResponseWriter interface {
    Header() Header
    Write([]byte) (int, error)
    WriteHeader(statusCode int)
}

// Optional richer behavior
type Flusher  interface { Flush() }
type Hijacker interface { Hijack() (net.Conn, *bufio.ReadWriter, error) }
type Pusher   interface { Push(target string, opts *PushOptions) error }
```

Middleware in Go composes by wrapping `Handler`:

```go
func WithLogging(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        h.ServeHTTP(w, r)
        log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
    })
}
```

Because the interface is small, `WithLogging` does not need to know anything else about the handler. Stack as many wrappers as you want.

---

## Practical Refactor — From Big to Small

Suppose you inherit this:

```go
type Cloud interface {
    UploadObject(bucket, key string, data []byte) error
    DownloadObject(bucket, key string) ([]byte, error)
    DeleteObject(bucket, key string) error
    ListBuckets() ([]string, error)
    PutACL(bucket, key, acl string) error
    StreamUpload(bucket, key string, r io.Reader) error
    PresignURL(bucket, key string, ttl time.Duration) (string, error)
    GetMetadata(bucket, key string) (Metadata, error)
}
```

Eight methods, used by half a dozen services. Mocks are awful. Refactor:

```go
// Used by upload service
type Uploader interface {
    StreamUpload(bucket, key string, r io.Reader) error
}

// Used by download service
type Downloader interface {
    DownloadObject(bucket, key string) ([]byte, error)
}

// Used by signed-url generator
type Presigner interface {
    PresignURL(bucket, key string, ttl time.Duration) (string, error)
}

// Used by admin tooling
type Admin interface {
    ListBuckets() ([]string, error)
    PutACL(bucket, key, acl string) error
}
```

The concrete `*S3Client` still has all eight methods. It implements every small interface implicitly. Each service takes only the interface it needs:

```go
type UploadService struct {
    cloud Uploader
}
```

Tests now require a single-method fake.

---

## Code Review Checklist

- [ ] Each new interface is named with the `-er` suffix or matches an established standard library convention
- [ ] The interface is declared in the package that *uses* it
- [ ] The interface has at most three methods (and ideally one or two)
- [ ] If the type is supposed to satisfy a known interface, there is a `var _ I = (*T)(nil)` line
- [ ] Functions accept interfaces and return concrete types
- [ ] An exported interface has a godoc comment describing the contract
- [ ] Optional capabilities are exposed as separate interfaces, not added to existing ones
- [ ] Embedding (rather than copy-pasting method signatures) is used to compose
- [ ] No `IXxx` Java-style prefix; no `XxxInterface` redundant suffix
- [ ] Tests use small hand-written fakes, not enormous mocks

---

## Tricky Questions

**Q1: My team likes one big `Repository` interface for every entity. What's the cost?**

Every consumer takes a dependency on every method, so refactoring is painful and tests need huge mocks. Split per use case (`UserFinder`, `UserSaver`, ...).

**Q2: Should the interface be exported or unexported?**

Unexported when only the declaring package uses it (most cases). Export it when other packages legitimately need to talk in those terms — e.g., when you provide multiple implementations.

**Q3: When is it OK to define the interface next to the implementation?**

When the implementation *is* the canonical entry point — `io.Reader` lives in `io` because that package both defines and ships many implementations. For application code the rule is: prefer consumer-side.

**Q4: Should I always use a compile-time check?**

Use it for any concrete type whose **purpose** is to satisfy a particular interface. Don't bother for incidental satisfaction (e.g., a type that just happens to have a `String() string` method).

**Q5: How do I add a feature to an interface without breaking users?**

Add a new optional interface and detect via type assertion, OR add a new sibling interface that embeds the old one and adds the method. Never modify the original.

**Q6: My linter says "interface contains methods used in only one call site". Is that bad?**

It is a smell of premature abstraction. If there is only one implementation and one caller, drop the interface and use the concrete type directly until you have a real second use.

---

## Summary

Middle-level interface practice is about turning the junior rules into mechanical habits:

1. **Consumer-side** — declare interfaces in the package that calls them.
2. **Compile-time check** — `var _ I = (*T)(nil)` near every type that intends to satisfy a contract.
3. **Optional interfaces** — expose extra capabilities through separate interfaces and detect with type assertion.
4. **Documentation** — a godoc that explains semantics, errors, concurrency, and optional cousins.
5. **Versioning** — never add a method to an existing exported interface; embed or sibling instead.
6. **Embedding** — compose small interfaces into bigger ones declaratively.
7. **Testing** — small interfaces produce small fakes.

The standard library follows every one of these. When in doubt, open `io`, `http`, or `sort` and copy the pattern.
