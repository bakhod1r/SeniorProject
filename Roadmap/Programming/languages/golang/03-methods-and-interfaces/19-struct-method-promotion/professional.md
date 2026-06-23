## Struct Method Promotion - Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Composition vs Inheritance](#composition-vs-inheritance)
3. [API Design at Scale](#api-design-at-scale)
4. [Logger Embedding Pattern](#logger-embedding-pattern)
5. [sync.Mutex Embedding Pattern](#syncmutex-embedding-pattern)
6. [Method-Set Propagation in Production](#method-set-propagation-in-production)
7. [Ambiguity and Disambiguation Strategy](#ambiguity-and-disambiguation-strategy)
8. [Shadowing as a Refactoring Tool](#shadowing-as-a-refactoring-tool)
9. [Anti-Patterns Catalog](#anti-patterns-catalog)
10. [Refactoring Legacy Code](#refactoring-legacy-code)
11. [Testing and Mocking Promoted Methods](#testing-and-mocking-promoted-methods)
12. [Tooling, Linters, and Code Review](#tooling-linters-and-code-review)
13. [Summary](#summary)

> Scope note: This file is about **STRUCT method promotion** (an outer struct that has an unnamed embedded struct field). The neighboring topic `06-embedding-interfaces` is about **interface embedding** (one interface listing another interface in its method set). The two mechanisms share the keyword "embedding" but answer different design questions: struct embedding produces a **concrete** type with promoted **methods**, while interface embedding produces an **abstract** type with promoted **method signatures**.

---

## Introduction

At the professional level, struct embedding is rarely chosen for the convenience of saving a few keystrokes. It is chosen because the outer type is meant to **be a kind of** the inner type for the purposes of an interface, while still adding extra fields, extra methods, or hooks. Because Go's promotion is purely syntactic sugar over field access, every promoted method is still a regular method - it just appears, from the caller's perspective, to belong to the outer type.

The trade-offs that matter in production code:

- A promoted method silently couples the outer type's API to the inner type's API. If the inner type adds a public method, that method also becomes part of the outer type's public API.
- A promoted method-set governs interface satisfaction, which means embedding decisions ripple into adapter code, mock implementations, and test fixtures.
- Pointer-vs-value embedding determines whether methods with a `*Inner` receiver are reachable from a value of `Outer`, which is the single most common source of "method not found" compile errors in real code reviews.

This document focuses on those production trade-offs.

---

## Composition vs Inheritance

The Go FAQ is unambiguous: "Embedding is not subclassing." Yet many teams that come from Java, C#, or Python try to use embedding as inheritance and run into trouble months later. The differences that actually matter:

| Property | Inheritance (Java-style) | Go embedding |
|---|---|---|
| `super.M()` available | Yes | No - only `outer.Inner.M()` |
| Override means runtime polymorphism | Yes | No - shadowing is purely lexical |
| Inner type sees outer fields | Yes (via `this`) | No - inner has no knowledge of outer |
| Interface satisfaction | By declaration | By method set |
| Diamond problem | Possible | Caught at compile time as ambiguity |

The "inner has no knowledge of outer" point is the one that surprises developers most. Consider:

```go
type Animal struct{ Name string }

func (a Animal) Describe() string {
    return a.Name + " makes a sound"
}

type Dog struct {
    Animal
    Sound string
}

d := Dog{Animal: Animal{Name: "Rex"}, Sound: "woof"}
fmt.Println(d.Describe()) // "Rex makes a sound"
```

There is no way for `Animal.Describe` to know that `Sound == "woof"`. In a Java mindset you would override `Describe()` in `Dog` and call `super.Describe()`. In Go you write a new method on `Dog`:

```go
func (d Dog) Describe() string {
    return d.Animal.Describe() + " (" + d.Sound + ")"
}
```

The qualifier `d.Animal.Describe()` is the equivalent of `super.describe()` - and it must always be written explicitly. There is no shorthand.

### Why the Go team made this choice

Two reasons keep showing up in design notes and Rob Pike's talks:

1. **Decoupling**: an inner type that does not know it is being embedded can be reused everywhere. If a base class could call into derived code via virtual dispatch, that base class would be fragile.
2. **Compile-time clarity**: a method call `o.M()` always resolves to exactly one method, decided at compile time. This makes diff review and IDE navigation trivial.

In practice this means **the question you ask before embedding is not "is it a kind of?" but "does the outer type want to expose all of the inner type's methods as if they were its own?"** If the answer is no, prefer a named field.

---

## API Design at Scale

In a large codebase a struct's public method set is its contract. Promotion modifies that contract automatically. The discipline of API ownership therefore shifts:

```go
// Before: contract is the methods Server itself declares
type Server struct {
    addr string
}
func (s *Server) Start() error { /* ... */ }
func (s *Server) Stop()  error { /* ... */ }

// After: contract now also includes everything Listener exposes
type Server struct {
    *net.Listener   // embedded
    addr string
}
```

The second form gives `Server` every method `*net.Listener` has - including `Accept`, `Close`, `Addr`. If a future Go version adds a method to `net.Listener`, every `Server` in the world quietly gains that method. If a teammate later adds a `Close()` to `Server` directly, they unintentionally **shadow** the listener's `Close()` and break behavior. None of this is caught by `go vet`.

### Heuristic for production code

- Embed when the outer type is meant to be **substitutable** for the inner type wherever the inner type's interface is required, and you accept the inner type's full API as part of the outer type's contract.
- Use a named field when you want **encapsulation** - the inner type is an implementation detail and only a curated subset of methods should be public.

A typical example of the first case is `bufio.Reader` wrapping `io.Reader` - except `bufio.Reader` does **not** embed; it uses a named field `rd io.Reader` precisely because it wants to control the public surface. Note this carefully: even the standard library prefers named fields when control matters.

### Two contrasting library designs

```go
// Design A: embedding - "is-a"
type AuditedDB struct {
    *sql.DB
    audit AuditLog
}
// AuditedDB has every method *sql.DB has, plus whatever we add.
// Drop-in replacement for *sql.DB.

// Design B: named field - "has-a", curated facade
type ManagedDB struct {
    db    *sql.DB
    audit AuditLog
}
func (m *ManagedDB) Query(ctx context.Context, q string) (*Rows, error) {
    m.audit.Record(q)
    return wrapRows(m.db.QueryContext(ctx, q))
}
```

Design A is great for decorators that should be transparent. Design B is great when the wrapping type is the **new** API that users should depend on.

---

## Logger Embedding Pattern

Embedding a logger is the most common idiomatic use of struct method promotion in production Go code, and it has subtle pitfalls.

```go
type Logger struct {
    prefix string
    out    io.Writer
}

func (l *Logger) Info(msg string)  { fmt.Fprintln(l.out, l.prefix, "INFO", msg) }
func (l *Logger) Warn(msg string)  { fmt.Fprintln(l.out, l.prefix, "WARN", msg) }
func (l *Logger) Error(msg string) { fmt.Fprintln(l.out, l.prefix, "ERROR", msg) }
```

A service struct embeds the logger so every internal call site can write `s.Info(...)` instead of `s.log.Info(...)`:

```go
type Service struct {
    *Logger
    repo UserRepo
}

func NewService(repo UserRepo) *Service {
    return &Service{
        Logger: &Logger{prefix: "[svc]", out: os.Stdout},
        repo:   repo,
    }
}

func (s *Service) Register(u User) error {
    s.Info("registering " + u.Email)        // promoted from *Logger
    if err := s.repo.Save(u); err != nil {
        s.Error("save failed: " + err.Error())
        return err
    }
    return nil
}
```

This works, looks clean, and is widely used. The pitfalls:

### Pitfall 1: nil-embedded-pointer panic

If `Service.Logger` is nil and the method dereferences the receiver, calling `s.Info(...)` panics. The compiler will not catch it because `s.Info` is statically valid - the method exists. The fix is either to check `nil` defensively inside `Logger`'s methods or to construct services through a factory that guarantees the logger is initialized.

```go
func (l *Logger) Info(msg string) {
    if l == nil { return }
    fmt.Fprintln(l.out, l.prefix, "INFO", msg)
}
```

This pattern (nil-receiver-as-no-op) is borrowed from `*log.Logger` in the standard library.

### Pitfall 2: leaking the logger's API

Because `*Logger` is embedded, callers from outside the package can write `svc.Logger.out = somethingElse` (if `out` were exported) or `svc.Info("...")` themselves. The latter may be desirable, but it is still a coupling decision: any future method added to `Logger` immediately becomes part of `Service`'s API.

If you want the convenience inside the package but not the surface area outside it, embed an **unexported** logger type:

```go
type logger struct{ /* ... */ }
func (l *logger) info(string)  { /* ... */ }

type Service struct {
    *logger      // unexported - no promotion to external API
    repo UserRepo
}
```

Now `Service.info(...)` is callable inside the package but invisible to importers.

### Pitfall 3: shadowing on rename

Suppose `Logger` originally has `Log(msg string)` and you embed it. Later, someone adds `Log(msg, level string)` to `Service` directly. The new method **shadows** the promoted one, and old call sites such as `s.Log("hi")` break with a compile error. Code review must catch this; tooling generally does not warn.

---

## sync.Mutex Embedding Pattern

Embedding `sync.Mutex` is so common it is in the standard library's own examples. The pattern:

```go
type Counter struct {
    sync.Mutex
    n int
}

func (c *Counter) Inc() {
    c.Lock()
    defer c.Unlock()
    c.n++
}
```

`Lock` and `Unlock` are promoted methods from `sync.Mutex` (which has a pointer receiver). Because we embedded by value, the method set of `*Counter` contains them; the method set of `Counter` (value) does not. This is correct - you must always operate on a pointer to a struct that contains a mutex, otherwise the mutex would be copied.

### When to embed vs name the mutex

```go
// Embedded
type Counter struct {
    sync.Mutex
    n int
}
c.Lock()       // works - promoted

// Named
type Counter struct {
    mu sync.Mutex
    n  int
}
c.mu.Lock()    // explicit
```

Production heuristics:

- **Embed** when the mutex is the type's primary synchronization primitive **and** you want callers (within the package) to be able to lock the value externally. Example: a cache where the user wants to take the lock around a multi-step compound operation.
- **Name** the mutex (`mu`) when it is an internal implementation detail. This is the more common idiom; `sync.Map`, `bytes.Buffer`, `os.File` all use named locks internally.

The risk of embedding `sync.Mutex` is that **the lock methods leak into the public API**. Anyone holding a `*Counter` can call `c.Lock()` and either deadlock the type or hold the lock indefinitely. Most production code therefore prefers a named, lowercase `mu`.

A second risk: `go vet` will flag a value receiver on a method of a type that contains `sync.Mutex` (either embedded or named) because it indicates a copy-of-lock bug.

```go
func (c Counter) Snapshot() int { return c.n } // go vet: passes lock by value
```

The fix is to use a pointer receiver everywhere on the type.

### Embedding `sync.RWMutex`

The same pattern works with `sync.RWMutex`. If you embed both fields, name them so promotion does not double-up `Lock`:

```go
// Anti-pattern - both have Lock(), this is a compile error
type Bad struct {
    sync.Mutex
    sync.RWMutex
}
```

Two embedded fields each promoting `Lock` produces an ambiguous selector. Either embed only one, or name both.

---

## Method-Set Propagation in Production

The propagation rules are critical for predicting interface satisfaction:

- Embed a value `T`: outer's value method set gains `T`'s value methods. Outer's pointer method set gains `T`'s value methods plus `*T`'s pointer methods (because `*Outer` lets you take `&outer.T`).
- Embed a pointer `*T`: both outer's value method set and outer's pointer method set gain everything from `T`'s and `*T`'s method sets - the pointer is already addressable.

```go
type Inner struct{}
func (i  Inner) V() {}
func (i *Inner) P() {}

type ByValue struct{ Inner }
type ByPointer struct{ *Inner }

var bv  ByValue
var bvp *ByValue
var bp  ByPointer
var bpp *ByPointer

bv.V()   // OK
bv.P()   // OK if bv is addressable - compiler does (&bv.Inner).P()
bvp.V()  // OK
bvp.P()  // OK

bp.V()   // OK
bp.P()   // OK
bpp.V()  // OK
bpp.P()  // OK
```

The non-obvious case is `bv.P()`. If `bv` is a local variable (addressable), it works. If `bv` is the result of a function call or an element of a map (not addressable), it does not.

```go
m := map[string]ByValue{"k": {}}
// m["k"].P() // compile error - cannot take address of m["k"]
```

This is the same constraint that affects pointer-receiver methods on map elements - promotion does not magic it away.

### Practical consequence: interface satisfaction

```go
type Closer interface { Close() error }

type Inner struct{}
func (i *Inner) Close() error { return nil }

type Outer struct{ Inner } // value embed

var _ Closer = &Outer{} // OK
// var _ Closer = Outer{} // compile error - Outer's value method set lacks Close()
```

If `Outer` had embedded `*Inner`, both forms would compile. This is the most common cause of "does not implement interface" errors in real code.

---

## Ambiguity and Disambiguation Strategy

If two embedded fields each promote a method with the same name, the selector becomes ambiguous. Go does **not** pick a winner - it reports a compile error at the call site:

```go
type Reader struct{}
func (Reader) Read() {}

type Writer struct{}
func (Writer) Read() {}

type ReadWriter struct {
    Reader
    Writer
}

var rw ReadWriter
// rw.Read() // ambiguous selector rw.Read
rw.Reader.Read() // OK
rw.Writer.Read() // OK
```

Note something important: the ambiguity is only an error **at the use site**. You can declare `ReadWriter` without ever calling `Read()` and the code compiles. This is sometimes called the "dormant ambiguity" pattern: harmless until somebody actually tries to use it.

### How Go avoids the diamond problem

In C++ a diamond like

```
       Base
      /    \
   Mid1    Mid2
      \    /
      Derived
```

leads to questions about whether `Derived` has one or two `Base` instances. Go has no such problem because each embedded field is a **distinct field** in the outer struct - the language never silently merges them. If `Mid1` and `Mid2` both embed `Base`, then a `Derived` struct that embeds both has **two separate `Base` instances** and any selector that could resolve to either is a compile error.

```go
type Base struct{ ID string }
func (b Base) BaseID() string { return b.ID }

type Mid1 struct{ Base }
type Mid2 struct{ Base }

type Derived struct {
    Mid1
    Mid2
}

var d Derived
// d.BaseID() // ambiguous - d.Mid1.Base.BaseID vs d.Mid2.Base.BaseID
d.Mid1.BaseID() // OK
d.Mid2.BaseID() // OK
```

Compile-time ambiguity rejection is a **feature**: the language refuses to choose for you, which means refactors that introduce conflicts cannot ship silently.

### Disambiguation at scale

In a large codebase, when you must combine two embedded types whose method sets overlap:

1. Decide which version is canonical for the outer type.
2. Define a method on the outer type with that name. It will shadow both promoted methods.
3. Inside the new method, call the canonical one explicitly.

```go
func (rw *ReadWriter) Read() (int, error) {
    return rw.Reader.Read() // canonical
}
```

This converts the dormant ambiguity into a deliberate decision and makes intent clear in code review.

---

## Shadowing as a Refactoring Tool

A method declared on the outer type with the same name as a promoted method shadows the promoted one. This is intentional and useful:

```go
type Base struct{}
func (Base) Greet() string { return "hello" }

type Polite struct{ Base }
func (Polite) Greet() string { return "good day" }

var p Polite
fmt.Println(p.Greet())      // "good day"
fmt.Println(p.Base.Greet()) // "hello"
```

Use cases:

- **Decoration**: wrap a promoted method to add logging, metrics, retries.
- **Deprecation migration**: shadow the old method on the new wrapper type and emit a warning.
- **Behavior override**: provide a domain-specific implementation while reusing the rest of the embedded type's surface.

```go
type Tracing struct {
    *sql.DB
}

// shadow with a tracing version
func (t *Tracing) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    span := trace.StartSpan(ctx, "db.query")
    defer span.End()
    return t.DB.QueryContext(ctx, q, args...) // explicit qualifier
}
```

Notice the `t.DB.QueryContext(...)` - this is the only way to reach the original. Without the explicit qualifier the call would recurse.

---

## Anti-Patterns Catalog

### Anti-pattern 1: Embedding for code reuse

```go
type StringFormatter struct{}
func (StringFormatter) FormatName(s string) string { return strings.Title(s) }

type User struct {
    StringFormatter // embedded just to reuse FormatName
    Name string
}

u := User{Name: "alice"}
fmt.Println(u.FormatName(u.Name))
```

`FormatName` does not depend on `User`'s state. It belongs in a package-level function, not a type. The embedding here pollutes `User`'s public method set with `FormatName` for no reason.

### Anti-pattern 2: Promoting a leaky abstraction

```go
type Service struct {
    *http.Client // promotes Do, Get, Post, Head, ...
}
```

A `Service` user can now call `s.Do(req)` directly, bypassing whatever validation, retry, or rate limiting the service was supposed to provide. Use a named field.

### Anti-pattern 3: Embedded type with mismatched lifetime

```go
type Cache struct {
    sync.Mutex
    data map[string]string
}

c := Cache{data: map[string]string{}}
c2 := c // copies the mutex - bug
```

Embedded `sync.Mutex` is fine, but the type now must always be passed by pointer. Make this explicit by:

- using only pointer receivers, and
- providing a `New` constructor that returns `*Cache`.

Better still, name the mutex and keep it private; promotion of `Lock`/`Unlock` to the public API is rarely what you want.

### Anti-pattern 4: Embedding to satisfy an interface lazily

```go
type partialReader struct{ io.Reader }

func (p partialReader) Read(buf []byte) (int, error) {
    n, err := p.Reader.Read(buf)
    // some custom handling
    return n, err
}
```

Embedding `io.Reader` here only to inherit "every other method" is fine if there are other methods - but `io.Reader` only has `Read`. The embedding adds nothing and makes `partialReader.Reader` a public-looking field. Prefer:

```go
type partialReader struct{ inner io.Reader }
func (p partialReader) Read(buf []byte) (int, error) { /* ... */ }
```

### Anti-pattern 5: Diamond ambiguity left dormant

```go
type A struct{}
func (A) Run() {}

type B struct{}
func (B) Run() {}

type C struct{ A; B }
```

`C` compiles. Six months later somebody writes `c.Run()` and it does not compile. The conflict has been latent. In code review, flag any embedding combination where method names could clash and force an explicit resolution.

---

## Refactoring Legacy Code

Embedding decisions are sticky because they affect the public method set. Two safe refactor patterns:

### Pattern 1: Embed -> name + delegate

When you discover that an embedded field is leaking too much API:

```go
// before
type Service struct {
    *Logger
}

// after
type Service struct {
    log *Logger
}

func (s *Service) Info(msg string)  { s.log.Info(msg) }
func (s *Service) Warn(msg string)  { s.log.Warn(msg) }
// Error, Debug, etc. - only what you actually want public
```

This is breaking if external callers used `s.Logger.X` directly, but non-breaking if they only used the promoted forms. Track usage with `grep -r "\.Logger\." ./...` before the refactor.

### Pattern 2: Convert promoted method to shadowed method

When you need to add behavior around a promoted method but want to keep callers unchanged:

```go
type Repo struct{ *sql.DB }

// new shadow with logging
func (r *Repo) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    log.Println("query:", q)
    return r.DB.QueryContext(ctx, q, args...)
}
```

External callers continue to write `r.QueryContext(...)`; behavior changes inside.

---

## Testing and Mocking Promoted Methods

Promoted methods complicate test doubles. If `Service` embeds `*Logger`, replacing the logger in tests means swapping the `Logger` field:

```go
type Service struct {
    *Logger
    repo UserRepo
}

func TestRegister(t *testing.T) {
    var buf bytes.Buffer
    s := &Service{
        Logger: &Logger{prefix: "[test]", out: &buf},
        repo:   &fakeRepo{},
    }
    _ = s.Register(User{Email: "x@y"})
    if !strings.Contains(buf.String(), "registering") {
        t.Fatal("expected log line")
    }
}
```

If `Logger` were an interface (`type Logger interface { Info(string); ... }`) and embedded, the test could substitute any implementation. Embedding interfaces is covered in `06-embedding-interfaces`; here we note only that interface embedding is the standard refactor target when promoted-method substitutability is required.

For mocking generated by `mockgen` or hand-written fakes, the rule is: **only the explicit method set of the struct (declared + promoted) appears in the contract**. Generated mocks should not rely on the inner type's identity.

---

## Tooling, Linters, and Code Review

### `go vet`

- Reports passing `sync.Mutex` (or any `Locker`) by value, including when embedded and the method has a value receiver.
- Does **not** warn on dormant ambiguity from two embedded types sharing a method name.

### `staticcheck`

- ST1003 (naming): does not catch embedding-related issues directly but flags inconsistent receiver names that frequently appear when shadowing methods.
- SA4005 (ineffective field assignment): can trigger when an embedded field's method's side-effect assignment is shadowed.

### `revive`

- `unused-receiver`: catches methods that take the outer receiver but only call promoted methods - a sign the method should be a function.

### Custom analyzers

A team-specific analyzer worth writing:

- Detect embedded fields where the inner type comes from another module, and warn if any inner method is part of an `interface{}` type assertion downstream. This catches API-leak risks early.
- Detect `Outer` types whose declared method set has fewer than two methods - often a sign that the type is just a wrapper for the inner type and might as well be a type alias or a named field.

### Code-review checklist

- Does this embedding express "is a kind of" or just "has a"? If it's "has a", use a named field.
- Does promotion add **any** method that the outer type's documented contract should not include? If yes, name the field instead.
- Could any added method on the inner type in a future version cause shadowing or ambiguity?
- Is the inner field exported or unexported? Unexported is safer - external code cannot reach `outer.inner.M()`.

---

## Cheat Sheet

```
EMBED OR NAME?
─────────────────────────────────────────────
"Outer is-a Inner, expose all of Inner's API" → embed
"Outer has-a Inner, curated API"              → name field
"Want logging convenience inside package"     → embed unexported
"Sync primitive needed but private"           → name as `mu`

METHOD SET PROMOTION
─────────────────────────────────────────────
Embed T (value):   value-set gets T's value methods
                   *Outer-set gets T's value+pointer methods
Embed *T:          both sets get T's full method set

AMBIGUITY
─────────────────────────────────────────────
Two embedded promote same name → compile error AT USE SITE
Resolve by: outer.Inner.M() qualifier
            or define M on outer (shadowing)

SHADOWING
─────────────────────────────────────────────
Outer's M wins always; promoted M reachable only via outer.Inner.M()
Use for: decoration, deprecation, override

ANTI-PATTERNS
─────────────────────────────────────────────
Embedding for code reuse                    → use functions
Embedding leaky abstraction (*http.Client)  → use named field
Mutex embedded but copied by value          → always pointer
Dormant diamond ambiguity                   → resolve eagerly
```

---

## Summary

Struct method promotion in production Go is a precision tool, not a convenience. The professional decisions are:

1. Embed only when the outer type **is meant to be substitutable** for the inner type at the interface layer.
2. Treat every promoted method as part of the outer type's permanent public API.
3. Prefer named fields when encapsulation or curated APIs matter (the standard library does).
4. Always use pointer receivers on types that embed `sync.Mutex` or `sync.RWMutex`, and name the mutex if it is an implementation detail.
5. Resolve ambiguity eagerly - dormant compile errors are a tax on future contributors.
6. Use shadowing intentionally for decoration, deprecation, and behavioral override; document the explicit `outer.Inner.M()` form when the original is still useful.
7. Code review is the only effective check on embedding API leakage; tooling helps but is not sufficient.

Promotion is not inheritance. It is composition with a syntactic shortcut. Hold the shortcut to the same standard you would hold any other public-API decision, and the codebase will stay clean for years.
