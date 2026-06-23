# Interface Best Practices — Specification

> **Best-Practice Canon References**
> - [Effective Go — Interfaces](https://go.dev/doc/effective_go#interfaces)
> - [Effective Go — Interface names](https://go.dev/doc/effective_go#interface-names)
> - [Go Code Review Comments — Interfaces](https://go.github.io/styleguide/decisions/#interfaces)
> - [Google Go Style Decisions — Interfaces](https://google.github.io/styleguide/go/decisions#interfaces)
> - [Go FAQ — When should I define an interface?](https://go.dev/doc/faq#When_should_I_define_an_interface)
> - [Go Proverbs — Rob Pike](https://go-proverbs.github.io/)
> - [Go Wiki — CodeReviewComments](https://github.com/golang/go/wiki/CodeReviewComments)

This document is not a language specification — it codifies *idioms*. Where
the language spec defines what is **possible**, this document defines what is
**recommended**. Every rule cites a primary source from the canon above.

---

## Table of Contents

1. [Canon Reference](#1-canon-reference)
2. [The Postel Principle: Accept Interfaces, Return Concrete Types](#2-the-postel-principle-accept-interfaces-return-concrete-types)
3. [Define Interfaces at the Consumer Site](#3-define-interfaces-at-the-consumer-site)
4. [Interface Size: Smaller Is Better](#4-interface-size-smaller-is-better)
5. [Naming Conventions: The `-er` Suffix](#5-naming-conventions-the-er-suffix)
6. [Compile-Time Satisfaction Checks](#6-compile-time-satisfaction-checks)
7. [Interface Composition over Inheritance](#7-interface-composition-over-inheritance)
8. [Optional Interfaces and Capability Detection](#8-optional-interfaces-and-capability-detection)
9. [Interfaces vs Generic Constraints](#9-interfaces-vs-generic-constraints)
10. [The Interface Segregation Principle in Go](#10-the-interface-segregation-principle-in-go)
11. [Anti-Patterns and Code Smells](#11-anti-patterns-and-code-smells)

---

## 1. Canon Reference

### 1.1 Rob Pike's Proverbs

The most cited summary of Go interface idioms:

> **"The bigger the interface, the weaker the abstraction."**
>
> — Rob Pike, *Go Proverbs*, Gopherfest 2015

> **"Don't design with interfaces, discover them."**
>
> — Rob Pike, *Go Proverbs*

> **"interface{} says nothing."**
>
> — Rob Pike, *Go Proverbs* (in Go 1.18+ this is `any`, but the proverb stands)

### 1.2 Effective Go — The Original Source

> "Interfaces in Go provide a way to specify the behavior of an object: if
> something can do *this*, then it can be used *here*."
>
> — *Effective Go*, §Interfaces

> "By convention, one-method interfaces are named by the method name plus an
> `-er` suffix or similar modification to construct an agent noun: `Reader`,
> `Writer`, `Formatter`, `CloseNotifier` etc."
>
> — *Effective Go*, §Interface names

### 1.3 Code Review Comments

> "Go interfaces generally belong in the package that uses values of the
> interface type, not the package that implements those values. The
> implementing package should return concrete (usually pointer or struct)
> types: that way, new methods can be added to implementations without
> requiring extensive refactoring."
>
> — *CodeReviewComments — Interfaces*

### 1.4 Jack Lindamood — *Accept interfaces, return structs*

A widely-cited blog summary of the Postel rule applied to Go signatures:

```
Be conservative in what you do, be liberal in what you accept from others.
                                                          — Jon Postel, RFC 793
```

Translated to Go API design:

- **Inputs** are interfaces — wider acceptance, easier to mock.
- **Outputs** are concrete types — caller can use full method set, no surprise
  abstraction.

---

## 2. The Postel Principle: Accept Interfaces, Return Concrete Types

### 2.1 The Rule

A function or method should:

1. Accept the **smallest** interface that captures what it actually uses.
2. Return a **concrete type** (struct or pointer to struct), not an interface.

```go
// BAD — accepts a concrete type, returns an interface
func ReadAll(f *os.File) io.Reader { ... }

// GOOD — accepts an interface, returns a concrete type
func ReadAll(r io.Reader) ([]byte, error) { ... }
```

### 2.2 Why Accept Interfaces

- **Testability** — callers can pass a mock or a `bytes.Buffer` instead of a
  real `*os.File`.
- **Decoupling** — the function does not bind itself to a specific
  implementation.
- **Composability** — works with `io.MultiReader`, `io.LimitReader`, `gzip.Reader`,
  etc., for free.

### 2.3 Why Return Concrete Types

From the Go FAQ:

> "Returning an interface from a constructor function loses information.
> Callers may want to use methods that are not part of the interface."

Concrete returns:

- Preserve the full method set.
- Allow the package to add new methods to the type without breaking callers.
- Avoid forcing every caller to invent an interface for their particular use.

### 2.4 The Standard Library Pattern

`bufio.NewReader` is the canonical example:

```go
// Returns *bufio.Reader (concrete), accepts io.Reader (interface)
func NewReader(rd io.Reader) *bufio.Reader
```

A caller can pass `os.Stdin`, a `net.Conn`, a `*strings.Reader`, or a fake.
The returned `*bufio.Reader` exposes useful methods (`Peek`, `ReadLine`,
`UnreadByte`) that are not part of `io.Reader`.

### 2.5 Exceptions

Returning an interface is appropriate when:

1. **The implementation is intentionally hidden.** `database/sql.DB.Begin()`
   returns `*Tx` (concrete) but `database/sql/driver` returns interfaces
   because driver implementations are pluggable.
2. **Multiple implementations are returned through a factory.** `errors.New`
   returns `error` because `*errorString` is unexported.
3. **The function genuinely returns one of several behaviorally equivalent
   types** chosen at runtime — e.g. `crypto/tls.Config.GetCertificate` may
   return any `*tls.Certificate`.

---

## 3. Define Interfaces at the Consumer Site

### 3.1 The Rule

> Interfaces belong in the package that **uses** them, not the package that
> **implements** them.

This is sometimes called *consumer-side interface definition* or, in DDD
terminology, the *port* lives with the *application*, not the *infrastructure*.

### 3.2 Producer-Side (Wrong)

```go
// userrepo/postgres.go  ── infrastructure package
package userrepo

type UserRepo interface {                  // BAD: defined where implemented
    Find(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

type pgRepo struct{ db *sql.DB }
func (r *pgRepo) Find(...) ...
func (r *pgRepo) Save(...) ...
```

Problems:

- The implementation package now depends on the abstraction it tries to provide.
- Other consumers must import `userrepo` even when they only need a smaller
  subset (e.g. a read-only `Finder`).
- Adding a new method requires changing the interface, which breaks every
  caller — even those that never use it.

### 3.3 Consumer-Side (Right)

```go
// service/user.go  ── consumer package
package service

type userFinder interface {                // unexported, consumer-defined
    Find(ctx context.Context, id string) (*User, error)
}

type UserService struct{ finder userFinder }

func (s *UserService) Greet(ctx context.Context, id string) (string, error) {
    u, err := s.finder.Find(ctx, id)
    ...
}
```

```go
// userrepo/postgres.go ── infrastructure package
package userrepo

type Repo struct{ db *sql.DB }                 // concrete struct, no interface
func (r *Repo) Find(ctx context.Context, id string) (*User, error) { ... }
func (r *Repo) Save(ctx context.Context, u *User) error            { ... }
```

The wiring layer (`main.go` or a DI container) connects them:

```go
svc := service.NewUserService(userrepo.New(db))   // *Repo satisfies userFinder
```

### 3.4 Why This Works in Go

Go's structural typing means **no implementation declaration is needed**.
`*userrepo.Repo` automatically satisfies `service.userFinder` because the
method names and signatures match — neither package needs to know about the
other's interface.

### 3.5 References

- *CodeReviewComments — Interfaces* (canonical statement)
- Dave Cheney — *SOLID Go Design* (2016)
- Kat Zień — *How Do You Structure Your Go Apps?* (GopherCon 2018)

---

## 4. Interface Size: Smaller Is Better

### 4.1 The Proverb

> "The bigger the interface, the weaker the abstraction."
>
> — Rob Pike

### 4.2 The Gold Standard: `io.Reader` and `io.Writer`

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

Each is one method. They compose into nearly every I/O abstraction in the
language: files, network sockets, hashes, compressors, encoders, buffers,
and pipes all implement them. The smallness is the point — every type that
does *anything* with bytes can implement `io.Reader` without dragging in
unrelated obligations.

### 4.3 Recommended Sizes

| Methods | Verdict |
|--------:|---------|
| 1       | Ideal — direct match for behavior |
| 2       | Common — usually a Reader/Writer pair, e.g. `io.ReadCloser` |
| 3       | Acceptable for orchestration roles |
| 4–5     | Yellow flag — verify it's not two roles in one |
| 6+      | Red flag — split it |

### 4.4 Counterexample — When Bigger Is Justified

`http.ResponseWriter` has only three methods (`Header`, `Write`,
`WriteHeader`) but the *Hijacker*, *Flusher*, *CloseNotifier*, and *Pusher*
behaviors are intentionally **separate optional interfaces** rather than
glued together. This is the textbook example of *interface segregation*
preserved through capability detection (§8).

### 4.5 The Test

A useful self-check: can a single name cleanly describe what the interface
*does*? If not — split it.

```go
// One role: BAD
type UserManager interface {
    Find(id string) (*User, error)
    Save(u *User) error
    SendEmail(u *User, msg string) error
    Bill(u *User, cents int) error
}
```

The name `UserManager` says nothing because the type does four unrelated
things. Split:

```go
type UserStore interface {
    Find(id string) (*User, error)
    Save(u *User) error
}

type Mailer interface {
    Send(to string, msg string) error
}

type Biller interface {
    Charge(userID string, cents int) error
}
```

---

## 5. Naming Conventions: The `-er` Suffix

### 5.1 The Rule

From *Effective Go*:

> "By convention, one-method interfaces are named by the method name plus an
> `-er` suffix or similar modification to construct an agent noun: `Reader`,
> `Writer`, `Formatter`, `CloseNotifier`."

| Method        | Interface name |
|---------------|----------------|
| `Read`        | `Reader`       |
| `Write`       | `Writer`       |
| `Close`       | `Closer`       |
| `Format`      | `Formatter`    |
| `Stringer`    | `Stringer` (one-method, `String() string`) |
| `Sort`        | `sort.Interface` (special — see §5.4) |

### 5.2 When the Suffix Doesn't Work

Some method names don't pluralize cleanly. Choose a noun that names the
*role*, not the method:

| Method      | Awkward     | Better      |
|-------------|-------------|-------------|
| `Do`        | `Doer`      | acceptable  |
| `Run`       | `Runner`    | acceptable  |
| `Auth`      | `Auther`    | `Authenticator` |
| `Lock`      | `Locker`    | (used in `sync.Locker`) |

### 5.3 Don't Prefix with `I`

```go
// BAD (Java/C# habit)
type IReader interface { Read(p []byte) (int, error) }

// GOOD
type Reader interface { Read(p []byte) (int, error) }
```

> "Interface names in Go don't use a prefix or suffix to denote that they
> are interfaces."
>
> — *Google Go Style Decisions*

### 5.4 The `interface` Suffix Is Reserved for Special Cases

`sort.Interface` is the famous example — it's named that because the
package is `sort` and the type is *the* interface for sortable collections.
Don't name your own types `FooInterface`; use a role-based agent noun.

---

## 6. Compile-Time Satisfaction Checks

### 6.1 The Idiom

Add a `var _ I = (*T)(nil)` line near the type definition to assert at
compile time that `*T` satisfies `I`:

```go
type Repo struct{ db *sql.DB }

func (r *Repo) Find(id string) (*User, error) { ... }
func (r *Repo) Save(u *User) error            { ... }

// Compile-time guarantee that *Repo satisfies UserStore.
var _ UserStore = (*Repo)(nil)
```

### 6.2 Why

- The check **fails at compile time**, not at the use site of the variable.
- The error message points to *the type* that misses a method, not
  somewhere downstream:

  ```
  ./repo.go:42:5: cannot use (*Repo)(nil) (value of type *Repo)
      as type UserStore: missing method Save
  ```

- Keeps the implementer honest when the interface evolves in another
  package.

### 6.3 Variations

For value receivers, drop the pointer:

```go
type Color int
func (c Color) String() string { ... }

var _ fmt.Stringer = Color(0)
```

For when you don't want the variable bound:

```go
var _ io.Reader = (*MyReader)(nil)
```

The blank identifier ensures the symbol does not pollute the package
namespace and discards the value at link time.

### 6.4 When to Use It

- The implementation lives in **a different package** than the interface.
- The interface is an exported contract you want to lock in.
- You want a **fast feedback loop** for refactors.

When *not* to use it:

- The interface is defined in the same file and used immediately — the
  compiler will catch mismatches at the use site anyway.
- The check would need to run a constructor that has side effects — use
  `(*T)(nil)` instead, never call the constructor.

### 6.5 Reference

Used extensively in the Go standard library. Examples:

- `net/http`: `var _ Handler = HandlerFunc(nil)`
- `database/sql/driver`: `var _ driver.Conn = (*conn)(nil)`

---

## 7. Interface Composition over Inheritance

### 7.1 The Rule

Go has no inheritance. Build big interfaces by **embedding small ones**.

```go
type Reader interface { Read(p []byte) (int, error) }
type Writer interface { Write(p []byte) (int, error) }
type Closer interface { Close() error }

type ReadWriter   interface { Reader; Writer }
type ReadCloser   interface { Reader; Closer }
type WriteCloser  interface { Writer; Closer }
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### 7.2 Why Composition Wins

- Each leaf interface remains independently testable and mockable.
- Implementations gain composite interfaces *automatically* by satisfying
  each leaf.
- No diamond problem. No virtual-method overhead.

### 7.3 The Standard Library Lattice

The `io` package is built entirely on this principle. The full list as of
Go 1.22:

```
Reader, Writer, Closer, Seeker
ReadWriter, ReadCloser, WriteCloser, ReadSeeker, WriteSeeker, ReadWriteCloser
ReaderAt, WriterAt, ReaderFrom, WriterTo
ByteReader, ByteWriter, ByteScanner
RuneReader, RuneScanner
StringWriter
```

Every composite interface is the embedding of single-method interfaces.

### 7.4 Avoiding "God Interfaces"

A common smell is one interface that aggregates everything:

```go
// BAD
type Service interface {
    Read(p []byte) (int, error)
    Write(p []byte) (int, error)
    Close() error
    Authenticate(token string) (*User, error)
    Bill(amount int) error
    SendEmail(to, body string) error
}
```

This violates ISP (§10), is impossible to mock partially, and signals that
the type has too many responsibilities. Decompose:

```go
type Auther  interface { Authenticate(token string) (*User, error) }
type Biller  interface { Bill(amount int) error }
type Mailer  interface { Send(to, body string) error }
type Conn    interface { io.ReadWriteCloser }
```

---

## 8. Optional Interfaces and Capability Detection

### 8.1 The Pattern

Define a **base interface** that is universally implemented, then expose
**optional capabilities** as separate, narrower interfaces. Detect them at
runtime via type assertion.

```go
// http package — base contract
type ResponseWriter interface {
    Header() Header
    Write([]byte) (int, error)
    WriteHeader(statusCode int)
}

// Optional capabilities — checked via assertion
type Flusher       interface { Flush() }
type Hijacker      interface { Hijack() (net.Conn, *bufio.ReadWriter, error) }
type CloseNotifier interface { CloseNotify() <-chan bool }   // deprecated
```

### 8.2 Detecting at Runtime

```go
func handle(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "first chunk")
    if f, ok := w.(http.Flusher); ok {
        f.Flush()                  // graceful capability use
    }
}
```

### 8.3 Why This Beats a Fat Base Interface

- **Backward compatibility.** Adding a method to an existing interface
  breaks every implementation. Adding a *new* optional interface breaks
  nothing.
- **Minimal contract.** Implementers that don't need `Flush` aren't forced
  to implement a no-op.
- **Clarity at the call site.** The `if _, ok := ...` check documents that
  the behavior is optional.

### 8.4 Standard Library Examples

| Base                  | Optional                                                   |
|-----------------------|------------------------------------------------------------|
| `error`               | `interface{ Unwrap() error }`, `interface{ Is(error) bool }`, `interface{ As(any) bool }` |
| `io.Reader`           | `io.WriterTo` (faster path)                                |
| `io.Writer`           | `io.ReaderFrom` (faster path)                              |
| `os.FileInfo`         | `interface{ Sys() any }`                                   |
| `http.Handler`        | `http.Hijacker`, `http.Flusher`, `http.Pusher`            |
| `sql.Result`          | -                                                          |

### 8.5 The Pitfall

Don't use capability detection as a hidden parameter. If a caller *needs* a
capability, it should ask for the narrower interface explicitly:

```go
// BAD — silent fallback hides intent
func write(w io.Writer, data []byte) {
    if rf, ok := w.(io.ReaderFrom); ok { ... }
}

// GOOD — caller picks the contract
func write(rf io.ReaderFrom, data []byte) { ... }
```

Capability detection is for *opportunistic optimization*, not for required
behavior.

---

## 9. Interfaces vs Generic Constraints

### 9.1 Both Are "Interface Types"

After Go 1.18, the keyword `interface` describes **two distinct things**:

1. A traditional **method-set interface** (runtime polymorphism).
2. A **type set / constraint interface** (compile-time polymorphism for
   generics).

```go
// Method set — used at runtime
type Reader interface { Read(p []byte) (int, error) }

// Type set — used at compile time
type Numeric interface { ~int | ~int64 | ~float64 }
```

Both compile, but they're invoked differently.

### 9.2 When to Choose Method-Set Interfaces

Use a regular interface when:

- The set of types is **open** (third parties can implement it).
- Behavior is **polymorphic at runtime** (e.g. plugins, decorators).
- You need to **store mixed types** in the same slice/map.
- The overhead of dynamic dispatch is acceptable (almost always is).

### 9.3 When to Choose Generic Constraints

Use a constraint when:

- The set of types is **closed** and known at compile time.
- You want **zero-cost abstraction** (no itab, no escape).
- Behavior is **the same for all instantiations** (e.g. `Min[T cmp.Ordered]`).
- You need to **preserve concrete types in return values** (`func Map[T,U any]`
  returns `[]U`, not `[]any`).

### 9.4 The Rule of Thumb

> "Generics replace interfaces when the type information matters more than
> the behavior."

```go
// Method-set interface — caller only needs comparison
func Sort(s sort.Interface) { ... }

// Generic constraint — caller wants the slice typed
func SortSlice[T cmp.Ordered](s []T) { ... }
```

If you find yourself writing `interface{ Less(other any) bool }` and using
`any` everywhere — switch to a constraint:

```go
type Less[T any] interface { Less(other T) bool }
func Min[T Less[T]](a, b T) T { ... }
```

### 9.5 Hybrid Constraints

Constraints can mix method sets and type sets:

```go
type StringerNumeric interface {
    ~int | ~int64 | ~float64
    String() string
}
```

Use sparingly — most of the time you want one or the other.

### 9.6 Reference

- *Type Parameters Proposal* (Robert Griesemer, Ian Lance Taylor, 2021)
- `cmp.Ordered`, `constraints.Integer`, `constraints.Signed` in the
  standard library.

---

## 10. The Interface Segregation Principle in Go

### 10.1 ISP, Restated

> "Clients should not be forced to depend on methods they do not use."
>
> — Robert C. Martin, *Agile Software Development* (2002)

In Go this manifests as: **define many small interfaces, not few large
ones**. The consumer-side rule (§3) guarantees the segregation is enforced
naturally — each consumer defines only the methods *it* needs.

### 10.2 Worked Example

A fat interface:

```go
type FileSystem interface {
    Open(name string) (io.ReadCloser, error)
    Create(name string) (io.WriteCloser, error)
    Stat(name string) (os.FileInfo, error)
    Remove(name string) error
    Rename(old, new string) error
    Mkdir(path string, perm os.FileMode) error
    Chmod(name string, mode os.FileMode) error
}
```

A read-only consumer is forced to implement (or mock) seven methods even
when it only opens files. Segregate:

```go
type Opener  interface { Open(name string) (io.ReadCloser, error) }
type Creator interface { Create(name string) (io.WriteCloser, error) }
type Stater  interface { Stat(name string) (os.FileInfo, error) }
type Remover interface { Remove(name string) error }
```

Compose where required:

```go
type ReadWriteFS interface { Opener; Creator; Stater; Remover }
```

A read-only loader needs only `Opener` — and that's the only method any
mock has to provide.

### 10.3 ISP Smells

- The same mock has to stub many `panic("not implemented")` methods.
- Renaming one method touches dozens of unrelated callers.
- Two callers want non-overlapping subsets of the interface.

Each is a sign to split.

---

## 11. Anti-Patterns and Code Smells

### 11.1 Speculative Interfaces ("Don't Pre-Design")

> "Don't design with interfaces, discover them."
>
> — Rob Pike

Defining an interface for the *first* implementation of something is almost
always wrong:

```go
// BAD — only one implementation, no consumers, premature
package payments
type Payer interface { Pay(amount int) error }
type StripePayer struct{}
func (s *StripePayer) Pay(amount int) error { ... }
```

Wait until **at least two** distinct callers (or a test mock plus a real
implementation) need polymorphism. Until then, return the concrete struct.
You can always extract an interface later — Go's structural typing
guarantees zero refactoring cost on the implementation side.

### 11.2 Returning an Interface Where a Struct Suffices

```go
// BAD — caller can't access *Server.Shutdown(ctx) without type-asserting
func NewServer() Listener { ... }

// GOOD
func NewServer() *Server { ... }
```

The Go FAQ states this directly. Returning an interface is *information
loss*.

### 11.3 The `interface{}` (now `any`) as a Bag

```go
// BAD
func Process(input any) any { ... }

// GOOD — pick a concrete type or a generic
func Process[T Input](input T) Output { ... }
```

Rob Pike: *"interface{} says nothing."* It's appropriate for a few
deliberate cases (`fmt.Println`, `encoding/json`, generic containers
pre-1.18), and almost nowhere else.

### 11.4 Naming Interfaces After Implementations

```go
// BAD
type RedisCache interface { Get(k string) (string, error) }

// GOOD
type Cache interface { Get(k string) (string, error) }
```

The interface names a *role*, not an *implementation*. `RedisCache` should
be the concrete struct, not the abstraction.

### 11.5 Nil Interface vs Nil Concrete

A common bug. An interface variable is `nil` only when **both** type and
value are nil:

```go
func badNew() error {
    var e *MyError = nil
    return e                // returned interface is NOT nil
}

if err := badNew(); err != nil {
    // entered — err has type *MyError, value nil
}
```

The fix: never return a typed nil. Return `nil` literally:

```go
func goodNew() error {
    return nil
}
```

This trap is so common that *Effective Go* and the Go FAQ both call it out.

### 11.6 Mocking Concrete Types

If a function accepts a concrete struct, you cannot mock it. This is the
*reason* the Postel rule exists. The fix is to accept an interface — but
defined at the consumer site (§3), with only the methods actually used.

### 11.7 Empty Method Methods Just to Satisfy an Interface

```go
type Closer interface{ Close() error }
type X struct{}
func (X) Close() error { return nil }   // why does X "close"?
```

If `X` has nothing to close, it does not belong in a `Closer`-shaped slot.
This usually indicates a fat interface that needs splitting.

---

## Spec Compliance Checklist

- [ ] Every public function/method accepts the smallest interface it uses.
- [ ] Every public function/method returns concrete types, not interfaces.
- [ ] No interface is defined in the same package as its only implementation
      unless that package is the consumer.
- [ ] Single-method interfaces follow the `-er` suffix where it reads
      naturally.
- [ ] No interface name is prefixed with `I`.
- [ ] Cross-package implementations include a `var _ I = (*T)(nil)` check.
- [ ] No interface aggregates unrelated methods (ISP).
- [ ] Composite interfaces are built by embedding smaller ones.
- [ ] Optional capabilities are exposed as separate interfaces, not
      conditional methods.
- [ ] No interface has a single implementation with no plausible second
      implementation in sight.
- [ ] No function returns a typed nil through an interface return type.

---

## Cross-References

| Topic                  | Where                                            |
|------------------------|--------------------------------------------------|
| Interface declarations | `09-interface-declarations/specification.md`     |
| Method sets            | `02-pointer-vs-value-receivers/specification.md` |
| Type assertions        | `11-type-assertions/specification.md`            |
| Type switches          | `12-type-switch/specification.md`                |
| Generics constraints   | `04-generics/01-type-parameters/specification.md` |
| `error` interface      | `04-error-handling-basics/02-error-interface/`   |

---

## Further Reading

- *Effective Go* — https://go.dev/doc/effective_go
- *Go FAQ* — https://go.dev/doc/faq
- *Go Code Review Comments* — https://go.dev/wiki/CodeReviewComments
- *Google Go Style Guide* — https://google.github.io/styleguide/go/
- *Go Proverbs* (Rob Pike, Gopherfest 2015)
- *SOLID Go Design* — Dave Cheney, 2016
- *Practical Go: Real world advice for writing maintainable Go programs* —
  Dave Cheney, 2019
