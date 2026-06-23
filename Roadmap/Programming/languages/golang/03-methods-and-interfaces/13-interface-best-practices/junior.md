# Interface Best Practices — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why Best Practices Matter](#why-best-practices-matter)
5. [Practice 1 — Keep Interfaces Small](#practice-1-keep-interfaces-small)
6. [Practice 2 — Name with the -er Suffix](#practice-2-name-with-the-er-suffix)
7. [Practice 3 — Accept Interfaces, Return Concrete Types](#practice-3-accept-interfaces-return-concrete-types)
8. [Practice 4 — Define Interfaces Where They Are Used](#practice-4-define-interfaces-where-they-are-used)
9. [Practice 5 — Don't Pre-Design — Let It Emerge](#practice-5-dont-pre-design-let-it-emerge)
10. [Practice 6 — Compile-Time Satisfaction Check](#practice-6-compile-time-satisfaction-check)
11. [Practice 7 — Compose Small Interfaces](#practice-7-compose-small-interfaces)
12. [Practice 8 — Document Interfaces with Godoc](#practice-8-document-interfaces-with-godoc)
13. [Real-World Examples from the Standard Library](#real-world-examples-from-the-standard-library)
14. [Mini Cheat Sheet](#mini-cheat-sheet)
15. [Self-Assessment Checklist](#self-assessment-checklist)
16. [Common Pitfalls (and the Idiomatic Fix)](#common-pitfalls-and-the-idiomatic-fix)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What should an interface look like, and how do I introduce one without overdesigning it?"

In Go, an interface is just a list of method signatures. Anyone with those methods automatically satisfies the interface — there is no `implements` keyword. That simplicity is powerful, but it also means that **how** you write interfaces shapes the entire architecture of your codebase. Two engineers can both write valid Go and end up with very different maintainability.

This file walks through the *positive* rules — the things you should actively do — when introducing interfaces. It does not cover what to avoid (that lives in the companion section `14-interface-anti-patterns/`).

After reading this file you will be able to:
- Name an interface in idiomatic Go (the `-er` suffix)
- Decide on the right size for a new interface (usually one or two methods)
- Place the interface declaration on the *consumer* side rather than the *implementer* side
- Use the `var _ Interface = (*Type)(nil)` pattern to lock in a compile-time guarantee
- Recognise the design lessons of `io.Reader` and `io.Writer`

---

## Prerequisites
- Comfortable with Go's basic syntax (functions, structs, methods)
- Understand value vs pointer receivers
- Have written at least one type that satisfies an interface
- Know the role of a method set (see `09-method-sets-deep`)
- Familiar with running `go vet` and `go test`

---

## Glossary

| Term | Definition |
|--------|--------|
| **Interface** | A named set of method signatures |
| **Implicit satisfaction** | A type satisfies an interface when its method set includes all required methods — no declaration needed |
| **Consumer** | The package or function that *uses* the interface |
| **Producer / implementer** | The package or type that supplies a concrete value satisfying the interface |
| **-er suffix** | Idiomatic naming convention: `Reader`, `Writer`, `Closer`, `Stringer` |
| **Compile-time check** | The `var _ I = (*T)(nil)` line that fails to build if `*T` no longer satisfies `I` |
| **ISP** | Interface Segregation Principle — clients should not depend on methods they do not use |
| **Composition** | Building larger interfaces by embedding smaller ones |
| **Capability detection** | Using a type assertion to ask "does this value also support a richer interface?" |
| **Postel's law** | "Be conservative in what you send, liberal in what you accept" — applied to Go: accept interfaces, return concrete types |

---

## Why Best Practices Matter

Go gives you very few rules about interfaces, so the choices you make compound quickly. A poorly-shaped interface can:
- Force every implementer to write methods they don't need
- Tie consumer code to a specific concrete library
- Make tests painful because the mock has to be enormous

A well-shaped interface usually does the opposite: it is small, expressive, and emerges naturally from real usage. The Go standard library is the gold-standard reference — `io.Reader` and `io.Writer` are each a single method, yet thousands of types in the ecosystem satisfy them.

```go
// io.Reader — one method, used by half the standard library
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

That one method is enough to model files, network sockets, in-memory buffers, gzipped streams, HTTP response bodies, and more. **Small wins.**

---

## Practice 1 — Keep Interfaces Small

The single most important guideline. Most useful interfaces in Go have one or two methods.

### Why small?

- **Easy to satisfy.** The fewer the methods, the more types fit — including test fakes.
- **Easy to read.** A reader can grasp the interface in one glance.
- **Easy to compose.** Small interfaces can be embedded into bigger ones.
- **Aligned with the Single Responsibility Principle.**

### Example — start with the smallest useful interface

```go
package archive

// Bad — too broad, requires implementers to know about everything
type Storage interface {
    Read(name string) ([]byte, error)
    Write(name string, data []byte) error
    Delete(name string) error
    List(prefix string) ([]string, error)
    Stat(name string) (FileInfo, error)
    Watch(name string) (<-chan Event, error)
}

// Good — separate small interfaces, combine when needed
type Reader interface {
    Read(name string) ([]byte, error)
}

type Writer interface {
    Write(name string, data []byte) error
}

type Lister interface {
    List(prefix string) ([]string, error)
}
```

A function that only needs to read should accept `archive.Reader`, not the whole `Storage`.

### Rule of thumb

If your interface has more than three methods and the methods don't always travel together, split it.

---

## Practice 2 — Name with the -er Suffix

Idiomatic Go interface names describe behavior with the `-er` suffix. Examples from the standard library:

| Interface | Method | What it expresses |
|-----------|--------|-------------------|
| `io.Reader` | `Read(p []byte) (int, error)` | Something that can be read from |
| `io.Writer` | `Write(p []byte) (int, error)` | Something that can be written to |
| `io.Closer` | `Close() error` | Something that can be released |
| `fmt.Stringer` | `String() string` | Something that can be turned into a string |
| `sort.Interface` | `Len`, `Less`, `Swap` | A collection that can be sorted |
| `error` | `Error() string` | Something that describes a failure |

### How to apply

```go
// Good — describes what the type can DO
type Encoder interface {
    Encode(v any) error
}

type Authenticator interface {
    Authenticate(token string) (UserID, error)
}

// Bad — describes what the type IS
type EncoderInterface interface { ... }   // redundant suffix
type IEncoder interface { ... }           // Hungarian-style I-prefix is non-Go
```

### When the noun isn't a verb

`sort.Interface` works because the package name `sort` already supplies the verb. `error` is a special case in the language. For your own code, prefer the `-er` form.

---

## Practice 3 — Accept Interfaces, Return Concrete Types

This rule is sometimes called *Postel's law for Go*. It comes directly from Go's CodeReviewComments document.

```go
// Good — accept the smallest interface; return what you actually have
func Copy(dst io.Writer, src io.Reader) (int64, error) { ... }

func NewBuffer() *bytes.Buffer { return &bytes.Buffer{} }
```

### Why accept interfaces?

The function asks for the **least** it needs. Any caller who has *more* (a richer struct) can still pass it in.

```go
// Caller can pass anything that has a Write method
var f *os.File = ...
var b *bytes.Buffer = ...
var conn net.Conn = ...

io.Copy(f, src)
io.Copy(b, src)
io.Copy(conn, src)
```

### Why return concrete types?

When you return a concrete type, the caller can:
- See the full set of methods in their IDE
- Take advantage of fields and behavior beyond the minimal interface
- Wrap the result in any interface they want

```go
func Open(path string) (*os.File, error) { ... }     // concrete return — flexible

// vs.
func Open(path string) (io.ReadCloser, error) { ... } // forces the caller to lose info
```

The standard library follows this pattern: `os.Open` returns `*os.File`, not `io.Reader`. The caller can then assign it to whatever interface they need.

---

## Practice 4 — Define Interfaces Where They Are Used

This is the rule that surprises engineers coming from Java or C#. In Go, the **consumer** of an interface declares it, not the implementer. Because satisfaction is implicit, there is no need for the implementer to know about the interface.

### Bad — interface lives next to the implementation

```go
// File: storage/postgres.go
package storage

// All consumers are forced to import "storage" just to get the interface
type UserRepo interface {
    FindUser(id string) (*User, error)
    SaveUser(u *User) error
}

type PostgresUserRepo struct{ db *sql.DB }
func (r *PostgresUserRepo) FindUser(id string) (*User, error) { ... }
func (r *PostgresUserRepo) SaveUser(u *User) error { ... }
```

### Good — interface lives next to the consumer

```go
// File: notifier/notifier.go
package notifier

// Notifier only needs to look up users — nothing else
type userLookup interface {
    FindUser(id string) (*User, error)
}

type Service struct {
    users userLookup
}

func (s *Service) NotifyUser(id, msg string) error {
    u, err := s.users.FindUser(id)
    if err != nil { return err }
    return send(u.Email, msg)
}
```

```go
// File: storage/postgres.go — knows nothing about notifier
package storage

type PostgresUserRepo struct{ db *sql.DB }
func (r *PostgresUserRepo) FindUser(id string) (*User, error) { ... }
func (r *PostgresUserRepo) SaveUser(u *User) error { ... }
```

The notifier package can be tested without importing `storage`. The storage package can grow new methods without breaking notifier. Each consumer ends up with the *minimum* interface for its job, automatically applying the Interface Segregation Principle.

---

## Practice 5 — Don't Pre-Design — Let It Emerge

A common beginner mistake is to start with an interface "in case" we need to swap implementations later. Go encourages the opposite: write the concrete type first, see how it is used, **then** extract an interface when you have at least two real implementations or a clear need for mocking.

```go
// Step 1 — concrete type, no interface yet
type EmailSender struct {
    smtp *smtp.Client
}
func (s *EmailSender) Send(to, body string) error { ... }
```

If later we need to mock `Send` in tests, *now* we extract:

```go
// Step 2 — extracted only because there is a real second use
type Sender interface {
    Send(to, body string) error
}
```

The interface still lives next to the consumer (Practice 4), and it is exactly as small as it needs to be (Practice 1).

### Why this is better

- You don't write speculative methods you'll never use.
- The interface shape is informed by real call sites.
- Each method has a clear, observed purpose.

---

## Practice 6 — Compile-Time Satisfaction Check

When you build a concrete type intended to satisfy a particular interface, lock in that guarantee at compile time. The idiom is:

```go
var _ io.Reader = (*MyReader)(nil)
```

This declares an unused variable of type `io.Reader` whose value is a `nil *MyReader`. The compiler must verify that `*MyReader` satisfies `io.Reader`; if a method is removed or renamed, the build fails immediately.

### Full example

```go
package logfile

import "io"

type Tail struct {
    f *os.File
}

// Method that satisfies io.Reader.
func (t *Tail) Read(p []byte) (int, error) { ... }

// Compile-time check — moves the error from "users break" to "we break first"
var _ io.Reader = (*Tail)(nil)
```

### When to use it

- For every concrete type that is *intended* to satisfy a specific interface
- Especially when the interface comes from another package (because that's where silent breakage hides)
- Place it near the type definition or right after the methods

The check costs nothing at runtime — `nil` casts to interface are erased — but saves you from accidentally breaking the contract when refactoring.

---

## Practice 7 — Compose Small Interfaces

Go interfaces support **embedding**: a bigger interface is built by listing smaller ones. This is the idiomatic way to express compound behavior, replacing what other languages do with inheritance.

### From the standard library

```go
// io package
type Reader  interface { Read(p []byte) (int, error) }
type Writer  interface { Write(p []byte) (int, error) }
type Closer  interface { Close() error }

type ReadWriter interface {
    Reader
    Writer
}

type ReadCloser interface {
    Reader
    Closer
}

type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

This is brilliant because:
- Anyone who implements `Read` and `Write` automatically satisfies `ReadWriter` — no separate declaration.
- A function that only needs `Read` can ask for `Reader`; one that needs both can ask for `ReadWriter`.
- The composition is declarative — no copy-pasting method signatures.

### Apply to your own packages

```go
type DBExec interface {
    Exec(query string, args ...any) (Result, error)
}

type DBQuery interface {
    Query(query string, args ...any) (*Rows, error)
}

// A function that needs both reads and writes
type DB interface {
    DBExec
    DBQuery
}
```

Build up; do not subdivide a giant interface afterwards.

---

## Practice 8 — Document Interfaces with Godoc

Each exported interface should have a doc comment that starts with its name and explains:
1. The **contract** — what behavior the interface promises
2. Any **implementation rules** — for example, must `Read` return `0, io.EOF` or just `0, nil`?
3. Concurrency expectations
4. Optional sub-interfaces clients should look for

### Example — the actual `io.Reader` doc

```go
// Reader is the interface that wraps the basic Read method.
//
// Read reads up to len(p) bytes into p. It returns the number of bytes
// read (0 <= n <= len(p)) and any error encountered. Even if Read
// returns n < len(p), it may use all of p as scratch space during the
// call. If some data is available but not len(p) bytes, Read
// conventionally returns what is available instead of waiting for more.
//
// When Read encounters an error or end-of-file condition after
// successfully reading n > 0 bytes, it returns the number of bytes
// read. It may return the (non-nil) error from the same call or
// return the error (and n == 0) from a subsequent call. ...
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

That comment is bigger than the interface itself, and that is the right ratio. The interface tells the compiler what to check; the comment tells the human what the values mean.

### Your own code

```go
// Sender delivers messages to a remote recipient.
//
// Implementations must be safe for concurrent use by multiple
// goroutines. Send returns nil only after the message has been
// accepted by the underlying transport.
type Sender interface {
    Send(ctx context.Context, msg Message) error
}
```

---

## Real-World Examples from the Standard Library

### `io.Reader` and `io.Writer`

The two most important interfaces in Go. One method each. Together they describe almost every byte-stream interaction:

```go
// Anything readable
io.Reader

// Anything writable
io.Writer

// Pipe one to the other
n, err := io.Copy(dst, src)
```

Files, sockets, byte buffers, gzip streams, JSON encoders, HTTP bodies — they all fit. **One method, infinite reuse.**

### `fmt.Stringer`

```go
type Stringer interface {
    String() string
}
```

Implement `String()` and `fmt.Println(value)` will use it. Your custom enums, IDs, statuses — all benefit.

### `error`

```go
type error interface {
    Error() string
}
```

Built into the language. The smallest possible interface, yet the foundation of all error handling.

### `sort.Interface`

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

Three methods, and `sort.Sort` works on anything that satisfies them — slices, custom collections, even disk-backed records.

### `http.Handler`

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

One method. Every HTTP framework in Go composes around this single contract.

The pattern is consistent: **small, behavior-named, explicit about contract**.

---

## Mini Cheat Sheet

```
INTERFACE BEST PRACTICES — JUNIOR
──────────────────────────────────────────
1  Small (1-3 methods)
2  Name with -er suffix
3  Accept interfaces, return concrete types
4  Declare on the consumer side
5  Don't predesign — extract when needed
6  var _ I = (*T)(nil) compile-time check
7  Compose with embedding, not extending
8  Document the contract with godoc

REFERENCES
──────────────────────────────────────────
io.Reader / io.Writer    — gold standard
fmt.Stringer             — Print magic
error                    — language built-in
sort.Interface           — three methods, total flexibility
http.Handler             — one method, whole ecosystem
```

---

## Self-Assessment Checklist

- [ ] I can name an interface using the `-er` convention
- [ ] I can keep my interface to one or two methods unless there is a strong reason
- [ ] I can place an interface declaration in the package that *uses* it
- [ ] I know what the `var _ I = (*T)(nil)` line does and when to write it
- [ ] I can read `io.Reader`'s docs and explain the contract
- [ ] I prefer to write the concrete type first and extract an interface later
- [ ] I write a godoc comment describing the contract for each exported interface
- [ ] I compose larger interfaces by embedding smaller ones

---

## Common Pitfalls (and the Idiomatic Fix)

### Pitfall — declaring the interface in the implementation package

```go
// Cleaner — keep storage focused on storage
package storage
type UserRepo interface { FindUser(id string) (*User, error) }
type postgresRepo struct{}
func (r *postgresRepo) FindUser(id string) (*User, error) { ... }
```

Move `UserRepo` to the package that *consumes* it — usually a `service` or `handler` package.

### Pitfall — naming an interface after the implementation

```go
// Bad
type RedisCache interface { Get(key string) (string, error) }

// Good
type Cache interface { Get(key string) (string, error) }
```

The interface is the abstraction; concrete types live below it.

### Pitfall — adding methods speculatively

If no caller uses `Watch(prefix string) <-chan Event`, do not put it on the interface. Add it the day someone needs it.

### Pitfall — returning an interface "to be flexible"

```go
// Bad
func NewClient() Doer { return &client{} }

// Good — caller still has all the type's capabilities
func NewClient() *Client { return &Client{} }
```

---

## Summary

Best practices for Go interfaces are about **restraint, not power**. The smaller and more focused an interface is, the more useful it becomes. The further it lives from its implementations, the cleaner the dependency graph. The closer it follows the `-er` convention, the easier the next reader can guess what it does.

Start by building the concrete type. Use the type. When duplication or testing pressure shows up, extract a small interface on the consumer side. Lock the contract with a compile-time check, document it with godoc, and let composition do the rest.

The standard library has been doing this for fifteen years. `io.Reader` is still one method.

---

## Further Reading

- [Effective Go — Interfaces](https://go.dev/doc/effective_go#interfaces)
- [Go CodeReviewComments — Interfaces](https://go.dev/wiki/CodeReviewComments#interfaces)
- [Go FAQ — Interfaces](https://go.dev/doc/faq#implements_interface)
- [Rob Pike's "Go Proverbs"](https://go-proverbs.github.io/) — "The bigger the interface, the weaker the abstraction."
- [io package source](https://pkg.go.dev/io)
- Companion section: `04-interfaces-basics`
- Anti-patterns: `14-interface-anti-patterns`
