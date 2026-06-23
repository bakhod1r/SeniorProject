# Interface Anti-Patterns — Specification

> **Reference Material**
> This is a *spec of bad patterns* — a catalog of constructs that compile
> cleanly but violate Go's design philosophy. Sources:
> - Go FAQ — "Why is my nil error value not equal to nil?" (https://go.dev/doc/faq#nil_error)
> - Effective Go — "Interfaces" (https://go.dev/doc/effective_go#interfaces)
> - Go Code Review Comments — "Interfaces" (https://go.dev/wiki/CodeReviewComments#interfaces)
> - Go Proverbs — Rob Pike

---

## Table of Contents

1. [Scope and Definitions](#1-scope-and-definitions)
2. [Catalog Overview](#2-catalog-overview)
3. [AP-01 Typed-Nil Gotcha](#3-ap-01-typed-nil-gotcha)
4. [AP-02 Premature Abstraction](#4-ap-02-premature-abstraction)
5. [AP-03 Header Interface](#5-ap-03-header-interface)
6. [AP-04 Mock-Driven Design](#6-ap-04-mock-driven-design)
7. [AP-05 Setter/Getter Interfaces](#7-ap-05-settergetter-interfaces)
8. [AP-06 Interface Co-located With Sole Implementation](#8-ap-06-interface-co-located-with-sole-implementation)
9. [AP-07 Returning Interface Instead of Struct](#9-ap-07-returning-interface-instead-of-struct)
10. [AP-08 Pointer-to-Interface](#10-ap-08-pointer-to-interface)
11. [AP-09 Interface Bloat](#11-ap-09-interface-bloat)
12. [AP-10 io.Reader-Shaped Misuse](#12-ap-10-ioreader-shaped-misuse)
13. [AP-11 `interface{}` Instead of Generics](#13-ap-11-interface-instead-of-generics)
14. [AP-12 Pseudo-OOP "Animal Interface"](#14-ap-12-pseudo-oop-animal-interface)
15. [Detection Heuristics & Linters](#15-detection-heuristics-linters)

---

## 1. Scope and Definitions

Twelve anti-patterns (AP-01 .. AP-12). Each entry has **Bad**, **Why**, **Good**.
> **Effective Go** — "The interfaces of Go are usually small: one or two
> methods is the most common form." (https://go.dev/doc/effective_go#interfaces)

---

## 2. Catalog Overview

| ID    | Anti-Pattern                                | Severity | Diagnosable by |
|-------|---------------------------------------------|----------|----------------|
| AP-01 | Typed-nil returned as `error`               | Critical | `go vet`, `nilness` |
| AP-02 | Interface for a single implementation       | High     | reviewer |
| AP-03 | Header interface mirroring all methods      | High     | `interfacer`, reviewer |
| AP-04 | Mock-driven interface design                | High     | reviewer |
| AP-05 | Setter/getter wrapper interfaces            | Medium   | reviewer |
| AP-06 | Interface in same package as only impl      | Medium   | reviewer |
| AP-07 | Returning interface where struct fits       | High     | reviewer |
| AP-08 | `*io.Reader` (pointer to interface)         | Critical | `staticcheck SA1015 family` |
| AP-09 | Interface bloat (10+ methods)               | High     | reviewer |
| AP-10 | `Read([]byte) (int, error)` on a non-stream | Medium   | reviewer |
| AP-11 | `interface{}` parameter where generic fits  | Medium   | `gopls`, generics review |
| AP-12 | "Animal" pseudo-OOP hierarchy               | High     | reviewer |

---

## 3. AP-01 Typed-Nil Gotcha

### 3.1 Definition

> **Go FAQ** — "Interfaces are implemented as two elements, a type T and a
> value V. [...] An interface value is nil only if V and T are both unset.
> [...] If we store a nil pointer of type `*int` inside an interface value,
> the inner type will be `*int` regardless of the value of the pointer.
> Such an interface value will therefore be non-nil even when the pointer
> value V inside is nil." (https://go.dev/doc/faq#nil_error)

### 3.2 Memory layout

An interface variable in Go is a **two-word value** (16 bytes on amd64):

```
+---------------------+---------------------+
| *itab (type info)   | unsafe.Pointer data |
+---------------------+---------------------+
```

For empty interfaces the first word is `*_type`; for non-empty interfaces
`*itab` encodes both the static interface and the dynamic type. An interface
equals `nil` **only when both words are zero**.

```
nil interface :   tab=nil   data=nil    -> i == nil  true
typed-nil     :   tab=*itab data=nil    -> i == nil  FALSE
```

### 3.3 Bad

```go
type ValidationError struct{ Field string }

func (e *ValidationError) Error() string { return "invalid: " + e.Field }

func Validate(s string) error {
    var err *ValidationError      // nil pointer, but typed
    if s == "" {
        err = &ValidationError{Field: "name"}
    }
    return err                    // ALWAYS non-nil interface
}

func main() {
    if err := Validate("ok"); err != nil {
        fmt.Println("oops:", err) // prints "oops: invalid: " — value is nil!
    }
}
```

### 3.4 Why bad

- `return err` packages `(*ValidationError)(nil)` into an `error` interface.
- `err != nil` evaluates the *interface*, not the underlying pointer.
- The caller's nil check passes; the function then panics on first method
  call, or worse, uses a zero-valued struct silently.

### 3.5 Good

```go
func Validate(s string) error {
    if s == "" {
        return &ValidationError{Field: "name"}
    }
    return nil                    // untyped nil — interface zero
}
```

Rule: never return a typed-nil pointer from a function whose return type is an
interface. Either return the concrete pointer type, or return `nil` literal.

---

## 4. AP-02 Premature Abstraction

### 4.1 Bad

```go
// pkg/storage
type Storage interface {
    Save(key string, data []byte) error
    Load(key string) ([]byte, error)
}

type FileStorage struct{ root string }
func (f *FileStorage) Save(k string, d []byte) error { /* ... */ return nil }
func (f *FileStorage) Load(k string) ([]byte, error) { /* ... */ return nil, nil }
```

Only one implementation exists. The interface was introduced "in case we add
S3 later".

### 4.2 Why bad

- YAGNI: the abstraction has no second implementer. Abstractions inferred
  from a single example almost never fit the second case.
- Adds indirection (interface dispatch) for zero polymorphism gain.
- Pollutes godoc — readers see a method list duplicated in two places.
- Encourages **mock-driven design** (AP-04) for tests that could use the
  concrete type.

### 4.3 Good

```go
type FileStorage struct{ root string }
func (f *FileStorage) Save(k string, d []byte) error { /* ... */ return nil }
func (f *FileStorage) Load(k string) ([]byte, error) { /* ... */ return nil, nil }
```

Introduce the interface only when the *second* implementation appears — and
declare it in the **consumer's** package, not the producer's. See Go Code
Review Comments — "Interfaces" (https://go.dev/wiki/CodeReviewComments#interfaces).

---

## 5. AP-03 Header Interface

### 5.1 Definition

A "header interface" is one that lists every public method of an existing
struct, mirroring it method-for-method. The interface adds no abstraction; it
is a duplicate of the struct's API surface.

### 5.2 Bad

```go
type UserService interface {
    Register(ctx context.Context, email, password string) (*User, error)
    Login(ctx context.Context, email, password string) (string, error)
    Logout(ctx context.Context, token string) error
    ResetPassword(ctx context.Context, email string) error
    UpdateProfile(ctx context.Context, id string, p Profile) error
    Delete(ctx context.Context, id string) error
    GrantAdmin(ctx context.Context, id string) error
    // ... 14 more methods
}

type userService struct{ db *sql.DB }
// implements every UserService method
```

### 5.3 Why bad

- The interface is coupled 1:1 with the struct — changing the struct breaks
  the interface, which is the opposite of what abstraction should provide.
- Each consumer depends on the *full* surface area, not the methods it
  actually calls.
- Encourages 200-line mock files in tests.
- Violates the **Interface Segregation Principle**.

### 5.4 Good

Define small, role-specific interfaces in the consumer:

```go
// package billing
type Registrar interface {
    Register(ctx context.Context, email, password string) (*User, error)
}
```

The producer keeps a concrete `*UserService`. The consumer asks for the
narrowest behavior it needs.

---

## 6. AP-04 Mock-Driven Design

### 6.1 Bad

```go
// In production code
type Clock interface { Now() time.Time }

type clock struct{}
func (clock) Now() time.Time { return time.Now() }

// Service depends on Clock so we can mock it in tests
type Service struct{ c Clock }
```

The interface exists because a test wanted to swap in a fake.

### 6.2 Why bad

- Production design is contorted to serve test affordances.
- Encourages 1:1 mocks (`MockClock`, `MockUserService`) instead of fakes or
  real instances.
- Mocks drift from real behavior; tests pass while production fails.

### 6.3 Good

Inject a function or value, not an interface, when only one operation is
needed:

```go
type Service struct{ now func() time.Time }

func NewService() *Service { return &Service{now: time.Now} }

// In tests:
s := &Service{now: func() time.Time { return time.Unix(0, 0) }}
```

For multi-method dependencies, write **fakes** (real in-memory impls), not
mocks.

---

## 7. AP-05 Setter/Getter Interfaces

### 7.1 Bad

```go
type User interface {
    GetName() string
    SetName(string)
    GetEmail() string
    SetEmail(string)
    GetAge() int
    SetAge(int)
}
```

### 7.2 Why bad

- An interface with `Set*` methods is just exposing a struct's fields with
  extra ceremony.
- "Get" prefix is non-idiomatic in Go — Effective Go: "It's neither idiomatic
  nor necessary to put `Get` into the getter's name."
- Every consumer must know the *shape* of the data, defeating the
  abstraction.

### 7.3 Good

Use a plain struct, or unexported fields plus accessors when invariants
must be enforced:

```go
type User struct { Name, Email string; Age int }

// Or with invariants:
type User struct{ name, email string }
func NewUser(name, email string) (User, error) { /* validate */ }
func (u User) Name() string  { return u.name }
func (u User) Email() string { return u.email }
```

Effective Go: the getter for unexported `owner` should be `Owner()`, not
`GetOwner()` (https://go.dev/doc/effective_go#Getters).

---

## 8. AP-06 Interface Co-located With Sole Implementation

### 8.1 Bad

```go
// package userrepo
package userrepo

type Repo interface {
    Find(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

type pgRepo struct{ db *sql.DB }
func (r *pgRepo) Find(...) (...) { ... }
func (r *pgRepo) Save(...) (...) { ... }

func New(db *sql.DB) Repo { return &pgRepo{db: db} }
```

### 8.2 Why bad

- The producer cannot evolve its return type without breaking the interface.
- Consumers cannot define their own narrower interface — the type is exported
  as `Repo`, encouraging widespread use of the wide type.
- Combines AP-02, AP-03, and AP-07.

### 8.3 Good

Producer exports a struct; consumer declares an interface as needed:

```go
// package userrepo
type Repo struct{ db *sql.DB }
func (r *Repo) Find(...) (*User, error) { ... }
func (r *Repo) Save(...) error          { ... }
func New(db *sql.DB) *Repo              { return &Repo{db: db} }

// package signup (consumer)
type userFinder interface {
    Find(ctx context.Context, id string) (*User, error)
}
```

---

## 9. AP-07 Returning Interface Instead of Struct

### 9.1 Bad

```go
type Cache interface {
    Get(key string) (string, bool)
    Set(key, val string)
}

func NewCache() Cache { return &lruCache{} }   // returns interface
```

### 9.2 Why bad

- Caller cannot access fields or extra methods of the concrete type.
- Inhibits compiler optimizations (interface call > direct call).
- Forces every consumer onto the same fixed signature.
- Triggers AP-01 typed-nil if the implementation returns a typed nil.

### 9.3 Good

> **Go Proverb (Rob Pike)** — *Accept interfaces, return structs.*

```go
func NewCache() *LRUCache { return &LRUCache{} }
```

The caller can type-assert or define an interface from their side. The
producer keeps freedom to add methods without breaking consumers.

### 9.4 Exceptions

- `error` is conventional and required.
- Polymorphic factories (`io.Pipe` returning `(*PipeReader, *PipeWriter)`
  where each is concrete; or `database/sql.DB.Driver()` returning
  `driver.Driver`) are valid because *the abstraction is the point*.

---

## 10. AP-08 Pointer-to-Interface

### 10.1 Bad

```go
func Read(r *io.Reader, p []byte) (int, error) {
    return (*r).Read(p)
}
```

### 10.2 Why bad

An interface value is **already a reference type** — its data word holds a
pointer (or a small inline value). `*io.Reader` adds a redundant layer:

- Two indirections to call a method.
- Misleads readers into thinking the interface needs out-parameter semantics.
- Disables nil checks: `*r == nil` is rarely what you want.
- Generally a sign that the author tried to translate C++/Java pointer
  semantics literally.

### 10.3 Good

```go
func Read(r io.Reader, p []byte) (int, error) { return r.Read(p) }
```

### 10.4 Rare legitimate cases

`*interface{}` appears legitimately when:

- Reflecting through `reflect.ValueOf(&i).Elem()` to *replace* the boxed
  value.
- Implementing JSON-like decoders that need to assign to an addressable
  interface.

These are framework-internal uses, not API surface.

---

## 11. AP-09 Interface Bloat

### 11.1 Bad

```go
type Database interface {
    Connect(ctx context.Context) error
    Close() error
    Begin(ctx context.Context) (Tx, error)
    Commit(tx Tx) error
    Rollback(tx Tx) error
    Query(ctx context.Context, sql string, args ...any) (Rows, error)
    QueryRow(ctx context.Context, sql string, args ...any) Row
    Exec(ctx context.Context, sql string, args ...any) (Result, error)
    Prepare(ctx context.Context, sql string) (Stmt, error)
    Ping(ctx context.Context) error
    Stats() Stats
    SetMaxOpenConns(int)
    SetMaxIdleConns(int)
    // ... continues
}
```

### 11.2 Why bad

> **Go Proverb (Rob Pike)** — *The bigger the interface, the weaker the
> abstraction.*

A 14-method interface forces every implementer to satisfy 14 contracts.
Mocks become unwieldy. Consumers depend on far more than they use.

### 11.3 Good

Decompose into purpose-specific interfaces. The standard library's `io`
package is the canonical example:

```go
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }
type Closer interface { Close() error }

type ReadCloser interface { Reader; Closer }
```

Embedding lets composers build large interfaces only where needed.

---

## 12. AP-10 io.Reader-Shaped Misuse

### 12.1 Bad

```go
type Pricer struct{ /* ... */ }
func (p *Pricer) Read(b []byte) (int, error) {
    // returns the marshalled price as bytes
}
```

The signature matches `io.Reader`, but the type is not a stream — it
materializes a finite, structured value.

### 12.2 Why bad

- Confuses any reader of the code: "Why is `Pricer` an `io.Reader`?"
- Allows accidental composition with `bufio.NewReader`, `io.Copy`, etc., in
  ways that never make sense.
- Hides the actual operation behind a stream metaphor.

### 12.3 Good

```go
type Pricer struct{ /* ... */ }
func (p *Pricer) Quote() (Money, error) { /* ... */ }
```

Reserve `io.Reader` and `io.Writer` for byte streams whose length is
unknown until EOF.

---

## 13. AP-11 `interface{}` Instead of Generics

### 13.1 Bad (Go 1.18+)

```go
func Max(items []interface{}) interface{} {
    var best interface{}
    for _, x := range items {
        if best == nil || x.(int) > best.(int) { best = x }
    }
    return best
}
```

### 13.2 Why bad

- Boxing every element costs a heap allocation.
- Type assertions reintroduce the type system at runtime, with panics on
  mismatch.
- Loses static type checking entirely.

### 13.3 Good

```go
func Max[T cmp.Ordered](items []T) T {
    if len(items) == 0 { var z T; return z }
    best := items[0]
    for _, x := range items[1:] {
        if x > best { best = x }
    }
    return best
}
```

### 13.4 When `any` is still right

- Heterogeneous containers (`[]any`, `map[string]any`) where the values
  legitimately have unrelated types (config blobs, JSON nodes).
- Reflection-based libraries (`encoding/json`, `text/template`).

---

## 14. AP-12 Pseudo-OOP "Animal Interface"

### 14.1 Bad

```go
type Vehicle interface { Drive() }

type Car struct{}
func (Car) Drive() { fmt.Println("car driving") }

type Truck struct{}
func (Truck) Drive() { fmt.Println("truck driving") }

type Motorcycle struct{}
func (Motorcycle) Drive() { fmt.Println("motorcycle driving") }
```

The interface exists to model an "is-a" hierarchy carried over from Java.

### 14.2 Why bad

- Go interfaces are about *behavior at the use-site*, not about modelling
  taxonomies.
- The `Vehicle` interface only adds value if there is consuming code that
  meaningfully treats Cars and Trucks identically. If no such consumer
  exists, the abstraction is decorative.
- Cargo-cult OOP causes interface bloat and premature abstraction (AP-02).

### 14.3 Good

Drop the interface unless a real consumer needs it. If a route planner does
treat the types uniformly, declare a narrow interface *in the planner*:

```go
type Car struct{}
func (Car) Drive() { /* ... */ }
type Truck struct{}
func (Truck) HaulCargo(c Cargo) error { /* ... */ }

// in route planner
type driver interface { Drive() }
func Plan(d driver) { d.Drive() }
```

---

## 15. Detection Heuristics & Linters

### 15.1 Static analyzers

| Tool                          | Detects |
|-------------------------------|---------|
| `go vet` (nilness)            | typed-nil returns (AP-01) |
| `staticcheck` SA4022          | typed-nil errors |
| `revive`                      | exported, unused-receiver |
| `gocritic`                    | hugeParam, paramTypeCombine |
| `gopls` quick-fixes           | narrows interface parameters |

### 15.2 Review heuristics

Raise an anti-pattern question on PR review if you observe:

- An interface in the same file as its only implementation.
- An interface returned from a constructor.
- A test file importing 3+ "Mock" types.
- A method named `GetX` whose body is `return x.X`.
- An exported `*SomeInterface` parameter.
- More than 5 methods in any newly added interface.
- A `Read([]byte) (int, error)` on a non-stream type.
- `interface{}` parameters where every call site passes the same type.

### 15.3 Compliance checklist

- [ ] No function returns a typed nil through an interface return type.
- [ ] No interface has a single implementation in the same package.
- [ ] Constructors return concrete types unless polymorphism is explicit.
- [ ] No exported `*SomeInterface` exists in the API.
- [ ] No interface defines `Get*`/`Set*` field accessors.
- [ ] No interface exceeds 5 methods without a documented reason.
- [ ] `Read`/`Write` signatures are reserved for actual byte streams.
- [ ] `any` parameters are absent in new code unless necessary.
- [ ] Interfaces are declared in *consumer* packages where possible.
- [ ] Mocks derive from consumer-side interfaces, not the producer.

---

> "Don't design with interfaces, discover them." — Rob Pike, Go Proverbs.
