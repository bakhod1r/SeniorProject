# Interface Anti-Patterns — Interview Questions

## Table of Contents

1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Typed-Nil Deep Dive](#typed-nil-deep-dive)
5. [Tricky / Curveball Questions](#tricky-curveball-questions)
6. [Coding Tasks](#coding-tasks)
7. [System Design Style](#system-design-style)
8. [What Interviewers Look For](#what-interviewers-look-for)
9. [Cheat Sheet](#cheat-sheet)

---

## Junior-Level Questions

### Q1: What is an interface anti-pattern?

**Answer:** A construct that compiles fine but represents poor design — for
example creating an interface for a single implementation, returning an
interface where a struct works, or accidentally returning a typed nil from
a function whose return type is `error`.

### Q2: Where should an interface be defined: in the producer or consumer package?

**Answer:** In the consumer package. The Go Code Review Comments guide states
explicitly: "Go interfaces generally belong in the package that uses values
of the interface type, not the package that implements those values."

### Q3: What does "Accept interfaces, return structs" mean?

**Answer:** A Go proverb. Take interfaces as parameters (so callers can
pass any compatible type) but return concrete types (so callers keep the
full API and avoid hidden typed-nil bugs).

### Q4: Why is `GetName()` non-idiomatic in Go?

**Answer:** Effective Go states the getter for an unexported `name` field
should be `Name()`, not `GetName()`. The "Get" prefix is a Java/C# habit;
Go drops it.

### Q5: How many methods should a "good" Go interface usually have?

**Answer:** One or two. Effective Go: "The interfaces of Go are usually
small." `io.Reader` has one method; `io.ReadWriter` has two via embedding.
Go Proverb: "The bigger the interface, the weaker the abstraction."

---

## Middle-Level Questions

### Q6: What is a "header interface"?

**Answer:** An interface that lists every public method of an existing
struct, mirroring it 1:1. It adds no abstraction and tightly couples the
interface to the struct's surface. Symptoms: the interface and struct live in
the same file, every method signature is duplicated, every consumer depends
on the full surface.

### Q7: Why is returning an interface from a constructor problematic?

**Answer:** Three reasons:
1. The caller loses access to type-specific methods and fields.
2. The producer can no longer add new methods without making the interface
   drift.
3. It can hide typed-nil bugs: returning `(*MyType)(nil)` through an `error`
   or other interface return is non-nil to the caller.

### Q8: What is the typed-nil gotcha in one sentence?

**Answer:** An interface variable equals `nil` only when *both* its type word
and value word are zero; storing a nil pointer of any concrete type produces
a non-nil interface.

### Q9: Why is `*io.Reader` almost always wrong?

**Answer:** Interface values are already reference-shaped — the data word
holds a pointer (or inline value) and the type word identifies the concrete
type. Adding `*` introduces a redundant indirection, breaks idiomatic nil
checks, and is usually a transliteration of C/C++/Java pointer semantics.

### Q10: What is "mock-driven design"?

**Answer:** Designing production interfaces to satisfy mocking frameworks
rather than user needs. Symptoms: every external dependency, even
`time.Now()`, becomes an interface so it can be mocked; tests rely on
generated mocks rather than fakes; the interface set bloats over time.

### Q11: Why is creating an interface for a single implementation an anti-pattern?

**Answer:** YAGNI. Abstractions should be derived from at least two concrete
cases — otherwise the shape of the interface fits exactly one implementer
and almost never accommodates a real second implementer later. The cost is
extra indirection, duplicated method lists in godoc, and pressure to
mock-drive tests.

### Q12: What is interface bloat?

**Answer:** An interface with too many methods (commonly 7+, definitely 10+).
Every implementer must satisfy all of them; consumers depend on far more than
they use. The `io` package's small interfaces are the canonical antidote —
small interfaces compose into large ones.

### Q13: When is `any` (`interface{}`) the right parameter type?

**Answer:** When the value is genuinely heterogeneous (JSON nodes, config
blobs, reflection-based libraries). For homogeneous containers since Go 1.18,
generics (`[T any]`) provide static typing and avoid boxing.

### Q14: What is the "Animal interface" anti-pattern?

**Answer:** Modelling Go interfaces as Java/C#-style "is-a" taxonomies. Go
interfaces describe *use-site behavior*, not entity hierarchies. Building
`Vehicle{Drive()}`, `Car`, `Truck`, `Motorcycle` without a consumer that
treats them polymorphically is decorative OOP cargo-culting.

### Q15: Why are setter/getter interfaces bad?

**Answer:** They expose a struct's fields with extra ceremony, force "Get"
prefixes that violate Go conventions, and prevent the type from controlling
its own invariants. A struct with exported fields (or unexported fields plus
short accessors) is simpler.

---

## Senior-Level Questions

### Q16: How would you refactor a 14-method `UserService` interface?

**Answer:** Stop exporting the interface. Export the concrete `*UserService`
struct. In each consumer (e.g. `signup`, `billing`, `auth`), define a small
local interface listing only what that consumer uses:

```go
package billing
type registrar interface {
    Register(ctx context.Context, email, password string) (*User, error)
}
```

Consumers depend on the minimum; mocks shrink from 14 stubs to one or two.

### Q17: What should the standard library teach us about interface design?

**Answer:** `io.Reader`, `io.Writer`, `io.Closer` — single-method interfaces
that compose. `error` — single method, ubiquitous. `sort.Interface` — three
methods, exactly the operations a sorter needs. None of these are header
interfaces; none mirror a struct.

### Q18: How do you decide whether to return an interface vs a struct from a factory?

**Answer:**
- Return a struct (or pointer to struct) by default.
- Return an interface when polymorphism *is* the API — e.g.
  `database/sql/driver.Open(...) (driver.Conn, error)` — the abstraction is
  the point, multiple implementations exist, and the consumer never needs
  the concrete type.
- Never return an interface "in case we need it later".

### Q19: Why is "interface in the same package as the only implementation" worse than "interface in the consumer package"?

**Answer:** Co-location:
- Couples the interface evolution to the producer's release cycle.
- Makes the interface name canonical, encouraging widespread use of the
  wide type.
- Inhibits each consumer from defining its own narrow interface.
Consumer-side interfaces let multiple consumers define narrow,
context-specific contracts that the producer naturally satisfies (structural
typing).

### Q20: How do you spot mock-driven design in a code review?

**Answer:** Tells include:
- `MockX` types generated for every dependency.
- Interfaces named after the type being mocked rather than a role.
- Production code accepts `Clock interface { Now() time.Time }` instead of
  a `func() time.Time`.
- A 1:1 correspondence between production interfaces and test mocks.

### Q21: What is the relationship between "Accept interfaces, return structs" and the typed-nil gotcha?

**Answer:** Returning an interface invites typed-nil bugs because callers
write `if err != nil` against an interface that may carry a nil value with a
non-nil type. Returning a concrete pointer makes the nil check unambiguous
(`if p == nil` checks the data, not a tuple).

### Q22: When is a setter interface defensible?

**Answer:** When the setter performs validation or has side effects — at
that point it's not a setter, it's a domain operation. Name it accordingly:
`Activate(...)`, `Rename(...)`, `Charge(...)`, not `SetActive(true)`.

---

## Typed-Nil Deep Dive

This section is mandatory at the senior level. The interviewer will probe
both the *what* and the *why*.

### Q23: Walk through the memory layout of an interface value.

**Answer:** An interface is two words on a 64-bit machine:

```
+-------------+-------------+
|  itab/type  |  data       |
+-------------+-------------+
```

The first word is `*itab` (`*_type` for empty interfaces) — encodes the
static interface, the concrete type, and a method-pointer table. The second
is `unsafe.Pointer` — heap pointer or inlined small value. `i == nil` is
true **only when both words are zero**. After `var p *T = nil; var i error = p`,
the first word is `*itab(error, *T)` and the second is `nil` — the interface
is non-nil.

### Q24: Show the bug.

```go
type ValidationError struct{ Field string }
func (e *ValidationError) Error() string { return "invalid: " + e.Field }

func Validate(s string) error {
    var err *ValidationError
    if s == "" {
        err = &ValidationError{Field: "name"}
    }
    return err
}

if err := Validate("ok"); err != nil {
    fmt.Println("oops:", err) // prints; err is typed-nil but interface is non-nil
}
```

### Q25: Why does `fmt.Println("oops:", err)` not panic on the typed-nil?

**Answer:** `fmt` calls `err.Error()`. The method has a pointer receiver
`*ValidationError`. Method dispatch reaches the function body with `e == nil`,
and the body computes `"invalid: " + e.Field` — which **does** panic if
`e.Field` is dereferenced. In our example `e.Field` is a string field; on a
nil receiver this panics with `nil pointer dereference`. Some methods that
never dereference the receiver (e.g. `func (e *X) IsValid() bool { return e != nil }`)
do not panic, and that's exactly when typed-nil is hardest to spot.

### Q26: What does `errors.Is(err, nil)` return for a typed-nil?

**Answer:** `errors.Is(err, nil)` checks `err == nil` first; for a typed-nil
the interface is non-nil, so it returns `false`. The typed-nil propagates
quietly through `errors.Is` and `errors.As`.

### Q27: How does this gotcha interact with `defer`/`recover`?

**Answer:** Same trap. A function that does:

```go
defer func() {
    if r := recover(); r != nil { /* handle */ }
}()
```

is fine, but if you build a custom panic value via:

```go
var pe *PanicErr
panic(pe)
```

then `recover()` returns a non-nil `interface{}` whose data is nil — a
typed-nil with the same trap.

### Q28: How do you reliably check "is this error really nil"?

**Answer:** In order of preference:
1. **Don't return typed-nil.** Always `return nil` literal on success.
2. Return concrete pointer types from internal helpers; convert to `error`
   only at the boundary.
3. As a last resort, reflect:
   ```go
   v := reflect.ValueOf(err)
   if !v.IsValid() || (v.Kind() == reflect.Ptr && v.IsNil()) { /* really nil */ }
   ```

### Q29: How do `go vet` and `staticcheck` help?

**Answer:** `go vet` ships an `nilness` analyzer (and the `nilfunc` checker)
that flags some typed-nil patterns. `staticcheck` rule `SA4022` warns
on returning typed-nil errors. Neither covers every case; the programmer
remains responsible.

### Q30: Why didn't Go fix this in the language?

**Answer:** The two-word representation makes interface operations O(1):
equality, dispatch, and boxing all touch just two words. Fixing typed-nil
at the language level would require a runtime check on every interface
conversion (or "deep-nil" semantics) — both break compatibility and
complicate the model. Go documents the behavior instead.

---

## Tricky / Curveball Questions

### Q31: What does this print?

```go
type MyErr struct{}
func (*MyErr) Error() string { return "oops" }

func work() error {
    var e *MyErr
    return e
}

func main() {
    if err := work(); err == nil {
        fmt.Println("nil")
    } else {
        fmt.Println("not nil")
    }
}
```

- a) `nil`
- b) `not nil`
- c) panic
- d) compile error

**Answer: b — `not nil`**

`work` returns a typed-nil. The interface contains `(*itab(*MyErr), nil)`,
which is not equal to `nil`.

### Q32: Which of these is idiomatic?

```go
// A
func New() Service { return &service{} }

// B
func New() *service { return &service{} }   // service is unexported

// C
func New() *Service { return &Service{} }   // Service is exported
```

- a) A
- b) B
- c) C
- d) A and C

**Answer: c — C**

Return concrete types. A is "Return interfaces" anti-pattern. B exports an
unexported type, which leaks into godoc oddly.

### Q33: What's wrong with this signature?

```go
func Sum(items []interface{}) interface{} { /* ... */ }
```

- a) Nothing — works fine.
- b) Should use `[]any`.
- c) Boxes every element; should be generic since Go 1.18.
- d) Cannot compile.

**Answer: c**

`interface{}` (or `any`) for homogeneous numeric input forces heap boxing
and runtime type assertions. `func Sum[T cmp.Ordered](items []T) T` is the
1.18+ idiom.

### Q34: Reading test code, you see a 220-line `MockUserService` file. What's the smell?

**Answer:** Header interface (AP-03) and likely mock-driven design (AP-04).
The `UserService` interface mirrors a struct; consumers should depend on
narrow role interfaces, and mocks should shrink to a few methods each.

### Q35: Is this constructor good?

```go
func New() io.ReadCloser {
    var rc *myStream
    if !cfg.Enabled { return rc }   // typed-nil!
    return openStream()
}
```

**Answer:** No — the early return packages `(*myStream)(nil)` into
`io.ReadCloser`. Callers' `if rc != nil` succeed and then panic on `rc.Read`.
Fix: `return nil` literally, or restructure so the function never returns a
typed-nil.

### Q36: Spot the issue.

```go
type Config interface {
    GetTimeout() time.Duration
    SetTimeout(d time.Duration)
    GetMaxConn() int
    SetMaxConn(n int)
}
```

**Answer:** AP-05 (Setter/Getter interface) and AP-03 (header interface).
Replace with a struct or with an unexported-fields struct plus
`Timeout()` / `MaxConn()` accessors and a `WithTimeout(...)` option.

### Q37: True or false — "All cross-package boundaries should be interfaces."

**Answer:** False. This is a Java/Spring instinct. Go cross-package
boundaries are typically **concrete types**, with interfaces declared on the
consumer side when polymorphism is needed. Returning interfaces by default
causes typed-nil bugs and locks producers into rigid signatures.

---

## Coding Tasks

### Task 1: Fix the typed-nil bug

```go
type DBErr struct{ Code int }
func (e *DBErr) Error() string { return fmt.Sprintf("db error %d", e.Code) }

func Query(db *sql.DB) error {
    var e *DBErr
    if rows, err := db.Query("..."); err != nil {
        e = &DBErr{Code: 500}
    } else {
        defer rows.Close()
    }
    return e
}
```

**Solution:**

```go
func Query(db *sql.DB) error {
    rows, err := db.Query("...")
    if err != nil {
        return &DBErr{Code: 500}
    }
    defer rows.Close()
    return nil   // untyped nil — interface zero
}
```

### Task 2: Refactor the header interface

```go
package userrepo
type UserRepo interface {
    Find(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
    Delete(ctx context.Context, id string) error
    List(ctx context.Context, page, size int) ([]*User, error)
    Count(ctx context.Context) (int, error)
}
type pgRepo struct{ db *sql.DB }
// implements all
func New(db *sql.DB) UserRepo { return &pgRepo{db: db} }
```

**Solution:**

```go
package userrepo
type Repo struct{ db *sql.DB }
func (r *Repo) Find(...) (*User, error) { /* ... */ }
func (r *Repo) Save(...) error          { /* ... */ }
// ...
func New(db *sql.DB) *Repo { return &Repo{db: db} }
```

```go
package signup
type userFinder interface {
    Find(ctx context.Context, id string) (*User, error)
}
```

### Task 3: Replace `interface{}` with generics

```go
func First(items []interface{}) interface{} {
    if len(items) == 0 { return nil }
    return items[0]
}
```

**Solution:**

```go
func First[T any](items []T) (T, bool) {
    if len(items) == 0 { var z T; return z, false }
    return items[0], true
}
```

### Task 4: Remove the pointer-to-interface

```go
func Pipe(in *io.Reader, out *io.Writer) error {
    _, err := io.Copy(*out, *in)
    return err
}
```

**Solution:**

```go
func Pipe(in io.Reader, out io.Writer) error {
    _, err := io.Copy(out, in)
    return err
}
```

---

## System Design Style

### Q38: A team has `type Storage interface{ Save; Load }` with one impl `FileStorage`. They want to add S3. How do you proceed?

**Answer:** Reverse the relationship. Write `*S3Storage` with concrete
methods. In each consumer that needs to abstract over both, declare a
*narrow* interface (e.g. `type saver interface { Save(...) error }`). Both
`*FileStorage` and `*S3Storage` implement structurally; the producer-side
`Storage` declaration is removed.

### Q39: How do you organize tests without mock-driven design?

**Answer:** Production accepts narrow interfaces and concrete pointers.
Tests use **fakes** (small in-memory impls), not mocks — fakes encode real
behavior, mocks encode call expectations. Inject single behaviors as
functions (`now func() time.Time`). Use the concrete type directly when
no abstraction is warranted.

---

## What Interviewers Look For

### Junior
- Knows "anti-pattern"; recognizes typed-nil; knows getter naming; small interfaces.

### Middle
- Articulates "Accept interfaces, return structs"; explains consumer-side
  interface placement; spots header interfaces and 1:1 mocks; uses generics
  over `interface{}` since 1.18.

### Senior
- Walks through interface memory layout; fixes typed-nil bugs without
  notes; justifies exceptions; decomposes 14-method interfaces.

### Professional
- Designs APIs that resist anti-patterns by default; sets up CI linters;
  coaches refactors that preserve compatibility.

---

## Cheat Sheet

```
TYPED-NIL CHECKLIST
─────────────────────────────────────────
- Never `return e` where e is *T and return type is an interface.
- Always `return nil` literal on the no-error path.
- Internal helpers may return *T; convert to `error` only at the boundary.

INTERFACE LOCATION
─────────────────────────────────────────
- Producer -> exports concrete (struct/*struct).
- Consumer -> declares its own narrow interface.

INTRODUCE INTERFACE WHEN
─────────────────────────────────────────
- 2+ real implementations exist.
- Consumer has swap candidates (fake, prod, alt).
- Polymorphism IS the point (driver, plugin).

LINTERS
─────────────────────────────────────────
- go vet      : nilness, nilfunc
- staticcheck : SA4022, SA1015
- revive      : exported, unused-receiver
- gocritic    : hugeParam, paramTypeCombine

QUICK SMELL RADAR
─────────────────────────────────────────
- "I" prefix (IFooService)        -> Java import
- 8+ methods in new interface     -> bloat
- Iface in same file as sole impl -> co-location
- *io.Reader / *io.Writer         -> always wrong
- MockX for every dep             -> mock-driven design
- interface{} on homogeneous data -> use generics
- GetX/SetX accessor in iface     -> setter/getter trap
```
