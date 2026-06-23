# Struct Method Promotion — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Method-Set Propagation Theory](#method-set-propagation-theory)
3. [Interface Satisfaction via Promoted Methods](#interface-satisfaction-via-promoted-methods)
4. [Selector Resolution Order](#selector-resolution-order)
5. [Embedding for Decorators](#embedding-for-decorators)
6. [Refactoring with Embedding](#refactoring-with-embedding)
7. [Embedding and Concurrency](#embedding-and-concurrency)
8. [Encapsulation Strategy](#encapsulation-strategy)
9. [Generics + Embedding](#generics-embedding)
10. [Embedded Interfaces vs Embedded Structs](#embedded-interfaces-vs-embedded-structs)
11. [Pitfalls in Real Code](#pitfalls-in-real-code)
12. [Library Design Decisions](#library-design-decisions)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level, struct method promotion is no longer a syntax convenience — it is an **architectural tool** with measurable consequences:

- **Method sets** drive which interfaces a composed type satisfies.
- **Selector resolution** determines whether refactoring an inner type silently breaks an outer.
- **Decorators** built via embedding need careful thought about concurrency, copying, and cross-method calls.
- **Encapsulation** can leak: embedding promotes more than you may want.

Every example below is about embedding **a concrete struct** (or pointer to one). Interface embedding is a separate topic.

---

## Method-Set Propagation Theory

Senior-level mental model: when you embed, you are taking the **method set** of the inner and merging it into the outer's. Merge rules:

```
S embeds T:
  msetv(S)  = msetv(T)                  // value methods of T
  msetp(*S) = msetv(T) ∪ msetp(*T)      // value + pointer methods of T

S embeds *T:
  msetv(S)  = msetv(T) ∪ msetp(*T)      // pointer is already addressable
  msetp(*S) = msetv(T) ∪ msetp(*T)
```

Where `msetv(X)` is the value method set and `msetp(*X)` is the pointer method set.

### Practical implication

```go
type Doer interface{ Do() }

type Engine struct{}
func (*Engine) Do() {}            // pointer method only

type Car1 struct{ Engine }        // value embed
type Car2 struct{ *Engine }       // pointer embed

var _ Doer = &Car1{}              // OK   — *Car1 includes pointer Engine methods
// var _ Doer = Car1{}               // FAIL — Car1 (value) lacks pointer Engine methods
var _ Doer = Car2{Engine: &Engine{}} // OK — value embed of pointer
var _ Doer = &Car2{Engine: &Engine{}}// OK
```

When designing a public type, decide **which interfaces should be satisfied by values** vs only by pointers. Embedding choice (`T` vs `*T`) is the lever.

---

## Interface Satisfaction via Promoted Methods

A type `S` satisfies interface `I` if `I`'s method set ⊆ `S`'s method set, where `S`'s method set includes promoted methods.

### Stitching together an interface from parts

```go
type Reader interface { Read(p []byte) (int, error) }
type Closer interface { Close() error }
type ReadCloser interface { Reader; Closer }

type FileReader struct{}
func (*FileReader) Read(p []byte) (int, error) { return 0, nil }

type FileCloser struct{}
func (*FileCloser) Close() error { return nil }

type File struct {
    *FileReader
    *FileCloser
}

var _ ReadCloser = &File{FileReader: &FileReader{}, FileCloser: &FileCloser{}}
```

`*File` satisfies `ReadCloser` because `Read` and `Close` are both promoted.

### Replacing implementations later

```go
type Cache interface {
    Get(k string) (string, bool)
    Set(k, v string)
}

type Service struct {
    Cache    // embed the interface? No — that's interface embedding (topic 06).
}
```

Wait — embedding an interface (`Cache` is an interface) is **interface-in-struct** embedding, which behaves differently: it exposes the methods declared on the interface but routed through the stored interface value. That's a useful mid-ground but is not "struct method promotion" in the strict sense covered here. Use it consciously.

The strict struct-embedding equivalent is to embed a concrete type:

```go
type RedisCache struct{ /* ... */ }
func (*RedisCache) Get(k string) (string, bool) { return "", false }
func (*RedisCache) Set(k, v string) { /* ... */ }

type Service struct {
    *RedisCache // concrete embed
}

// s.Get(...) works; replacing implementation later requires editing the struct.
```

The trade-off is **flexibility (interface) vs simplicity (concrete)**.

---

## Selector Resolution Order

For a selector `x.f`, the compiler walks the type's hierarchy looking for `f`:

1. Look at `S` itself: does it declare a field/method `f`? If yes, use it.
2. Otherwise, look at all embedded fields **at depth 1** for `f`.
   - If exactly one match: use it.
   - If multiple: ambiguity error.
3. Otherwise, recurse into depth 2, depth 3, ... shallowest unique match wins.

Concrete example:

```go
type A struct{}; func (A) X() {}
type B struct{ A }
type C struct{ B }
type D struct {
    C
    A   // re-embedded directly!
}

var d D
d.X()  // resolves to D.A.X (depth 1), NOT D.C.B.A.X (depth 3)
```

### Refactoring danger

If someone adds a method or field with the same name to the inner, **shadowing changes silently**:

```go
type Inner struct{}
func (Inner) Process() {}

type Outer struct{ Inner }

// Later, someone adds Process to Outer:
func (Outer) Process() { /* new logic */ }

// All call sites o.Process() now resolve to the new method.
// The change is silent — no compile error.
```

This is a real refactoring hazard. Mitigations:
- Code review carefully when methods are added to outer types.
- Run integration tests on call sites.
- Prefer explicit forwarding when the API matters.

---

## Embedding for Decorators

The decorator pattern shines with embedding:

```go
type Repo interface {
    Find(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

type SQLRepo struct{ db *sql.DB }
func (r *SQLRepo) Find(ctx context.Context, id string) (*User, error) { /* ... */ return nil, nil }
func (r *SQLRepo) Save(ctx context.Context, u *User) error            { return nil }

// Decorator 1: caching
type CachingRepo struct {
    Repo               // embedded interface — promotes Find and Save
    cache *Cache
}

func (c *CachingRepo) Find(ctx context.Context, id string) (*User, error) {
    if u, ok := c.cache.Get(id); ok { return u, nil }
    u, err := c.Repo.Find(ctx, id) // call inner
    if err == nil { c.cache.Set(id, u) }
    return u, err
}
// Save is still promoted — no override

// Decorator 2: logging
type LoggingRepo struct {
    Repo
}

func (l *LoggingRepo) Find(ctx context.Context, id string) (*User, error) {
    log.Println("find:", id)
    return l.Repo.Find(ctx, id)
}
```

Stack decorators:

```go
sqlRepo := &SQLRepo{db: db}
cached  := &CachingRepo{Repo: sqlRepo, cache: NewCache()}
logged  := &LoggingRepo{Repo: cached}
// logged.Find -> log -> cached.Find -> SQL
```

Each decorator adds a behavior without rewriting the rest.

(Note: in this section we embed an `interface`-typed field. Strictly speaking that's interface-typed embedding inside a struct — the methods are promoted via the interface value's dynamic dispatch. The pure "struct embedding" equivalent uses a concrete type field.)

---

## Refactoring with Embedding

### Migrating common helpers into a base struct

**Before** (duplication):

```go
type ServiceA struct{ logger *Logger }
func (a *ServiceA) Info(msg string) { a.logger.Info(msg) }
func (a *ServiceA) Warn(msg string) { a.logger.Warn(msg) }

type ServiceB struct{ logger *Logger }
func (b *ServiceB) Info(msg string) { b.logger.Info(msg) }
func (b *ServiceB) Warn(msg string) { b.logger.Warn(msg) }
```

**After** (embedding):

```go
type Logger struct{ /* ... */ }
func (l *Logger) Info(msg string) {}
func (l *Logger) Warn(msg string) {}

type ServiceA struct{ *Logger }
type ServiceB struct{ *Logger }

// ServiceA{Logger: l}.Info(...)  — Info promoted
```

Less code, same behaviour, easier to keep consistent.

### When NOT to embed

When the inner's API is **wider** than what you want to expose:

```go
// Bad: embeds the whole http.Server, exposing 30+ public methods
type MyServer struct{ http.Server }

// Better: explicit field, expose only what you need
type MyServer struct{ srv *http.Server }
func (m *MyServer) Start() error { return m.srv.ListenAndServe() }
func (m *MyServer) Stop() error  { return m.srv.Close() }
```

### Splitting a god struct

If `App` has 50 methods, embed focused sub-types:

```go
type App struct {
    *Authenticator
    *RequestParser
    *DBConnector
    *TemplateEngine
}
```

Now each concern owns its methods, and `App` composes them. Be ready for ambiguity if any of them share method names.

---

## Embedding and Concurrency

### Embedding `sync.Mutex`

```go
type Counter struct {
    sync.Mutex
    n int
}

func (c *Counter) Inc() {
    c.Lock()         // promoted from sync.Mutex
    defer c.Unlock()
    c.n++
}
```

The promoted `Lock`/`Unlock` work, but **be careful**:
1. They become **part of the public API** of `Counter`. Outside callers can `c.Lock()` directly. That may be unwanted — they could deadlock you.
2. Copying a `Counter` value copies the mutex (`go vet` will warn). Always pass `*Counter`.

Solution: keep the mutex unexported as a regular field if you don't want to expose it.

```go
type Counter struct {
    mu sync.Mutex // private, unexported
    n  int
}
```

### `sync.WaitGroup` embedded

Same risk: callers gain `Add`, `Done`, `Wait`. They might call them at the wrong moment.

### Rule of thumb

Embed sync primitives only when the **lock is part of the public contract**. Otherwise keep them private fields.

---

## Encapsulation Strategy

Embedding promotes **all** methods of the inner that are visible at the call site:

| Inner method case | Visibility from outside the inner's package |
|---|---|
| Exported (`func (T) M()`) | Promoted, visible everywhere |
| Unexported (`func (T) m()`) | Promoted, visible **only inside the inner's package** |

```go
package data

type Repo struct{}
func (Repo) Save(x string) {}     // exported
func (Repo) cache(x string) {}    // unexported

type Logged struct{ Repo }

// Inside package data:
//   l := Logged{}; l.Save(...); l.cache(...) // both work
//
// In another package importing data:
//   l.Save(...)  // OK
//   l.cache(...) // ERROR: undefined (cache is unexported)
```

This is consistent with Go's normal export rules — embedding doesn't change them, but it does mean unexported behavior **leaks across the package boundary if both types live in the same package**.

---

## Generics + Embedding

You can embed a generic type, but the outer must specify the type parameters:

```go
type Container[T any] struct{ items []T }
func (c *Container[T]) Add(x T)     { c.items = append(c.items, x) }
func (c *Container[T]) Len() int    { return len(c.items) }

type IntList struct {
    Container[int] // must specify int
}

func main() {
    var il IntList
    il.Add(1)
    il.Add(2)
    fmt.Println(il.Len()) // 2 — promoted
}
```

Embedding `Container[T]` directly inside another generic struct is also allowed:

```go
type Stack[T any] struct {
    Container[T]
}

func (s *Stack[T]) Pop() T {
    n := len(s.items)
    v := s.items[n-1]
    s.items = s.items[:n-1]
    return v
}
```

The promoted `Add` and `Len` propagate the type parameter automatically.

---

## Embedded Interfaces vs Embedded Structs

A reminder of where this topic fits:

| Aspect | Embedded **struct** (this file) | Embedded **interface** value (different scope) |
|---|---|---|
| Inner type | Concrete struct | Interface |
| Forwarding | Compiler-generated wrapper | Dynamic dispatch via interface value |
| Replacing impl | Recompile / change struct | Set the interface field at runtime |
| Method set merging | Static, compile-time | Static (declared methods) |
| Use case | Reusable concrete behavior | Decorator with swap-in implementations |

You can mix them: a struct can embed both a concrete struct and an interface field. Just be aware of which kind you're using.

---

## Pitfalls in Real Code

### 1. Silent shadowing on update

```go
type Base struct{}
func (Base) Process() { /* v1 logic */ }

type Wrapper struct{ Base }

// Original: Wrapper.Process == Base.Process via promotion
// Author of Wrapper later adds:
func (Wrapper) Process() { /* v2 logic */ }

// All callers silently switch from v1 to v2 — no compile error.
```

**Mitigation**: tests, code review, and treating outer-method additions as semantic changes.

### 2. Lost interface satisfaction after refactor

```go
type Reader interface{ Read() }
type FileReader struct{}
func (*FileReader) Read() {}

type Doc struct{ *FileReader }
var _ Reader = &Doc{} // OK

// Refactor: change Read to value receiver "for performance"
// func (FileReader) Read() {} // now value receiver

// Doc still satisfies Reader (value method always promoted).
// But other places that relied on *FileReader specifically may break.
```

Method-set changes can have ripple effects across embedded structs.

### 3. Copying outer with embedded mutex

```go
type Cache struct {
    sync.Mutex
    data map[string]string
}

c := Cache{data: map[string]string{}}
c2 := c          // copies mutex! go vet warns
c2.Lock()        // independent lock — bug
```

Always pass `*Cache` once `sync.Mutex` is involved.

### 4. Nil pointer embed

```go
type S struct{ *Inner }
var s S
s.Inner.Method() // panic: nil deref
s.Method()       // depends on whether Method dereferences receiver
```

Initialise pointer embeds in constructors.

### 5. Promoted methods with surprising signatures

When `Inner` has `func (Inner) Equals(other Inner) bool`, the promoted `Outer.Equals` takes `Inner`, not `Outer` — comparing outer instances by `Equals` is not what naive readers expect.

---

## Library Design Decisions

### Decision 1: Should I embed or use a field?

| Want | Choose |
|---|---|
| Inner's full API exposed | Embed |
| Only some inner methods | Field + explicit forwarding |
| Behavior swap at runtime | Interface field |
| Cross-cutting concern (mutex, logger) | Embed (cautiously) |

### Decision 2: Value or pointer embed?

| Property | Value (`T`) | Pointer (`*T`) |
|---|---|---|
| Method set | Value methods only on outer | Full method set on outer |
| Storage | Inline (no indirection) | Heap allocation common |
| Copying outer | Copies inner | Shares inner |
| Init-required | Optional | Must allocate |
| sync primitives | Wrong (mutex copy) | Correct |

### Decision 3: Document promotions

```go
// Service handles authentication.
//
// Service embeds Logger; the methods Info, Warn, and Error
// are part of Service's API and forward to the embedded Logger.
type Service struct {
    *Logger
    // ...
}
```

Future readers shouldn't have to grep to find where `Info` came from.

---

## Cheat Sheet

```
METHOD SET PROPAGATION
──────────────────────────────────────────
Embed T  → S has T's value methods
         → *S has T's value + pointer methods
Embed *T → S and *S both have T's full method set

INTERFACE SATISFACTION
──────────────────────────────────────────
Composed type satisfies an interface iff its
(merged) method set covers the interface.

DECORATOR PATTERN
──────────────────────────────────────────
type Logged struct { Inner }
func (l Logged) M() { ... ; l.Inner.M() }
// other methods of Inner stay promoted

REFACTORING HAZARDS
──────────────────────────────────────────
- Adding a method to outer silently shadows inner's
- Switching value↔pointer receiver on inner
  changes the outer's method set
- Renaming an inner method keeps promotions —
  but breaks code that uses qualification

CONCURRENCY
──────────────────────────────────────────
- Embedded sync.Mutex exposes Lock/Unlock publicly
- Copying outer copies the mutex — bug
- Use *Outer for any embedded sync primitive

GENERICS
──────────────────────────────────────────
type Outer[T any] struct{ Container[T] }  // OK
Promotion forwards type parameter automatically.
```

---

## Summary

Senior-level use of struct method promotion:

1. **Method sets** propagate per concrete rules — value vs pointer embed matters.
2. **Interface satisfaction** is the most common reason to choose carefully between `T` and `*T` embedding.
3. **Selector resolution** uses depth + uniqueness; refactors can silently shadow.
4. **Decorators** are natural with embedding; override the methods you change, leave the rest promoted.
5. **Concurrency**: embedded `sync.Mutex` makes `Lock`/`Unlock` public; copying outers is dangerous.
6. **Encapsulation**: unexported methods are promoted but invisible across packages.
7. **Generics**: works seamlessly; the promoted methods carry the parameter through.
8. **Library design**: pick embedding for "share full API"; pick a regular field for "selective forward".

At the professional level we apply these patterns to large codebases, DDD, public API stability, and team conventions.
