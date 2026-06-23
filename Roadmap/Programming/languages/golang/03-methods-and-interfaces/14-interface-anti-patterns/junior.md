# Interface Anti-Patterns — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Typed-Nil Gotcha](#the-typed-nil-gotcha)
5. [Why Typed-Nil Happens (Memory Layout)](#why-typed-nil-happens-memory-layout)
6. [Premature Abstraction](#premature-abstraction)
7. [Interface for a Single Implementation](#interface-for-a-single-implementation)
8. [Returning Interface When Struct Is Sufficient](#returning-interface-when-struct-is-sufficient)
9. [The "Animal" Interface — Pseudo-OOP](#the-animal-interface-pseudo-oop)
10. [Setter/Getter Interfaces](#settergetter-interfaces)
11. [Common Mistakes Beginners Make](#common-mistakes-beginners-make)
12. [Symptoms of an Anti-Pattern](#symptoms-of-an-anti-pattern)
13. [Quick Refactor Recipes](#quick-refactor-recipes)
14. [Test](#test)
15. [Tricky Questions](#tricky-questions)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction
> Focus: "What is a Go interface anti-pattern, and why does it hurt me as a beginner?"

A Go interface is a tiny, beautiful tool. But the moment beginners reach for an interface, the patterns they import from Java, C#, or Python turn that tool against them. This file is a catalog of **what NOT to do**. The most famous trap — the "typed-nil gotcha" — is a textbook Go interview question and a real production bug. We start there.

Throughout this file each anti-pattern is presented as:
1. **BAD** — the broken example
2. **WHY** — why it hurts
3. **GOOD** — the idiomatic refactor

These are NOT positives. The positive equivalents live in `13-interface-best-practices/`.

After reading this file you will:
- Understand the typed-nil gotcha and why `err != nil` can be true even when `err` "looks" nil
- Recognize when an interface is being introduced too early
- Spot pseudo-OOP `Animal`-style designs and rewrite them
- Avoid `Get`/`Set` interface boilerplate

---

## Prerequisites
- Junior knowledge of methods and interfaces (see `04-interfaces-basics`)
- Familiarity with `error`, `fmt.Stringer`, `io.Reader`
- Ability to run `go run` and `go vet`

---

## Glossary

| Term | Definition |
|--------|--------|
| **Anti-pattern** | A common solution that looks correct but produces poor results |
| **Typed-nil** | An interface value whose type is non-nil but whose data pointer is nil |
| **Interface header** | (interface, type)+(interface, data) two-word internal layout |
| **Itab** | Interface type info — the (interface, dynamic type) pair |
| **Premature abstraction** | Adding an interface before two implementations exist |
| **Header interface** | An interface that copies every method of one struct |
| **Mock-driven design** | Inventing an interface only so the package can be mocked in tests |
| **Pseudo-OOP** | Java/C# class hierarchies translated literally into Go interfaces |

---

## The Typed-Nil Gotcha

This is the single most famous Go interview question. It looks impossible until you understand the memory layout.

### BAD

```go
type MyError struct {
    Code int
}

func (e *MyError) Error() string {
    return fmt.Sprintf("code=%d", e.Code)
}

func doWork() error {
    var err *MyError = nil   // we never assigned a real error
    return err               // returning a typed nil pointer as error
}

func main() {
    if err := doWork(); err != nil {
        fmt.Println("oops:", err) // PRINTS — but doWork "returned nil"!
    } else {
        fmt.Println("ok")
    }
}
```

Output: `oops: code=0`. Or worse — a panic when `Error()` dereferences `e.Code`.

### WHY

The function signature is `error` (an interface). When we wrote `return err` Go did NOT return `nil`. It returned an **interface value** with:

```
(type = *MyError, data = nil)
```

That interface value is **not equal to nil**. The comparison `err != nil` only succeeds when **both** the type word and the data word are nil. We have a non-nil type (`*MyError`) and a nil data pointer — the comparison fails.

### GOOD

Return the untyped `nil` literal directly when there is no error:

```go
func doWork() error {
    // ... nothing went wrong ...
    return nil   // untyped nil — both words zero
}

// Or, when an error CAN happen:
func doWork() error {
    var err *MyError
    if somethingFailed() {
        err = &MyError{Code: 42}
    }
    if err != nil {
        return err
    }
    return nil   // explicit nil exit
}
```

**Rule of thumb:** never declare a variable of an interface-implementing pointer type and return it. Always return either `nil` or a non-nil concrete value.

---

## Why Typed-Nil Happens (Memory Layout)

A Go interface value is a **two-word** structure:

```
┌──────────────────────┬──────────────────────┐
│  type pointer (itab) │  data pointer        │
└──────────────────────┴──────────────────────┘
```

### Cases

| Assignment | type word | data word | `== nil`? |
|--|--|--|--|
| `var e error` | nil | nil | true |
| `e = nil` | nil | nil | true |
| `var p *MyError = nil; e = p` | `*MyError` | nil | **false** |
| `e = &MyError{}` | `*MyError` | non-nil | false |

The third row is the bug. The interface "remembers" that the type is `*MyError` even though the data pointer is nil.

### Diagram

```
Untyped nil:         Typed nil (the bug):
┌─────┬─────┐        ┌────────────┬─────┐
│ nil │ nil │        │ *MyError   │ nil │   ← != nil!
└─────┴─────┘        └────────────┴─────┘
```

This is exactly why the Go FAQ has an entry titled "Why is my nil error value not equal to nil?"

---

## Premature Abstraction

### BAD

```go
// Day 1 of the project — only ONE database, only ONE implementation
type UserRepository interface {
    Find(id string) (*User, error)
    Save(u *User) error
    Delete(id string) error
}

type postgresUserRepository struct{ db *sql.DB }

func (r *postgresUserRepository) Find(id string) (*User, error) { /* ... */ }
func (r *postgresUserRepository) Save(u *User) error             { /* ... */ }
func (r *postgresUserRepository) Delete(id string) error         { /* ... */ }

func NewUserRepository(db *sql.DB) UserRepository {
    return &postgresUserRepository{db: db}
}
```

### WHY

There is **one** implementation. The interface adds no value:
- Every change to the implementation requires updating the interface too.
- Calls go through dynamic dispatch (slower, no inlining).
- Readers must jump from caller → interface → implementation.
- The interface implies polymorphism that isn't there.

The Go proverb: **"The bigger the interface, the weaker the abstraction."** And the corollary: **"Don't design with interfaces, discover them."**

### GOOD

Start with the concrete struct. Introduce the interface only when a second implementation appears (a fake for tests, a Redis cache, a different database):

```go
type UserStore struct{ db *sql.DB }

func NewUserStore(db *sql.DB) *UserStore { return &UserStore{db: db} }

func (s *UserStore) Find(id string) (*User, error) { /* ... */ }
func (s *UserStore) Save(u *User) error            { /* ... */ }
func (s *UserStore) Delete(id string) error        { /* ... */ }
```

If a second implementation arrives later, define the interface **at the consumer side** (the package that needs polymorphism). That keeps interface declarations small and focused.

---

## Interface for a Single Implementation

A close cousin of premature abstraction is the "interface in the same package as its only implementation."

### BAD

```go
package billing

type Charger interface {
    Charge(amount int) error
}

type StripeCharger struct{ apiKey string }

func (s *StripeCharger) Charge(amount int) error { /* ... */ }

// Nothing in this package, or anywhere else, has another implementation.
```

### WHY

- The interface and implementation are coupled: any change touches both.
- Go's idiom is **"accept interfaces, return structs."** Here we have a struct *and* its mirror interface in the same package — the producer is dictating the abstraction shape to the consumer.
- The interface is essentially documentation, but Go's interface is too heavy for documentation alone.

### GOOD

Return the concrete struct. Let consumers declare the interface they need on their side:

```go
package billing

type StripeCharger struct{ apiKey string }
func NewStripeCharger(key string) *StripeCharger { return &StripeCharger{apiKey: key} }
func (s *StripeCharger) Charge(amount int) error { /* ... */ }
```

```go
package checkout

// The CONSUMER declares only the methods it actually calls
type charger interface {
    Charge(amount int) error
}

type Service struct{ c charger }

func NewService(c charger) *Service { return &Service{c: c} }
```

Now `billing` doesn't carry a useless interface, and `checkout` declares exactly what it depends on.

---

## Returning Interface When Struct Is Sufficient

### BAD

```go
package store

type Cache interface {
    Get(key string) (string, bool)
    Set(key, value string)
}

type memCache struct { /* ... */ }
func (m *memCache) Get(key string) (string, bool) { /* ... */ }
func (m *memCache) Set(key, value string)         { /* ... */ }

// Returning the INTERFACE — locking the API
func NewCache() Cache {
    return &memCache{}
}
```

### WHY

- Callers cannot use any method that exists on `*memCache` but isn't on `Cache`.
- Adding a new method later (e.g. `Stats()`) is a **breaking change** for the interface — you cannot add it without breaking all alternative implementations.
- Returning a concrete type costs nothing — callers can always wrap it in their own interface if they want polymorphism.

### GOOD

```go
type MemCache struct { /* ... */ }
func NewMemCache() *MemCache { return &MemCache{} }
func (m *MemCache) Get(key string) (string, bool) { /* ... */ }
func (m *MemCache) Set(key, value string)         { /* ... */ }
func (m *MemCache) Stats() Stats                  { /* ... */ } // can grow freely
```

The Go proverb: **"Accept interfaces, return structs."**

---

## The "Animal" Interface — Pseudo-OOP

### BAD

This pattern is imported directly from Java/C# tutorials:

```go
type Animal interface {
    Speak() string
    Move() string
    Eat() string
}

type Dog struct{ name string }
func (d Dog) Speak() string { return "Woof" }
func (d Dog) Move() string  { return "Run" }
func (d Dog) Eat() string   { return "Crunch" }

type Cat struct{ name string }
func (c Cat) Speak() string { return "Meow" }
func (c Cat) Move() string  { return "Sneak" }
func (c Cat) Eat() string   { return "Nibble" }

func describe(a Animal) {
    fmt.Println(a.Speak(), a.Move(), a.Eat())
}
```

### WHY

- This isn't an interface — it's an attempted **inheritance hierarchy**. Go has no inheritance.
- The interface lumps three unrelated capabilities (speech, movement, feeding) into one bucket.
- Any new "animal" must implement all three even when most of them are irrelevant.
- Most production Go code has **no parallel** to "Animal" — code speaks in terms of `Reader`, `Closer`, `Stringer`, not "kinds of objects."

### GOOD

Decompose by **capability**, not by **noun**, and only when a real consumer requires polymorphism. In a real domain you might write:

```go
type Speaker interface { Speak() string }

type SpeechBubble struct { /* ... */ }
func (b *SpeechBubble) Render(s Speaker) string { return s.Speak() }
```

Each interface stays small (often one method) and exists because **a consumer needs polymorphism over that exact behavior**.

---

## Setter/Getter Interfaces

### BAD

```go
type User interface {
    GetName() string
    SetName(string)
    GetEmail() string
    SetEmail(string)
    GetAge() int
    SetAge(int)
}

type appUser struct {
    name, email string
    age         int
}

func (u *appUser) GetName() string  { return u.name }
func (u *appUser) SetName(n string) { u.name = n }
// ... and so on for every field
```

### WHY

- This is a Java/C# JavaBean pattern. Go has **exported struct fields** for this.
- The interface is just a bucket of accessors — there is no behavior, no abstraction, no decision being made.
- Tests, JSON marshaling, and reflection all break in subtle ways when a struct is hidden behind getters/setters.

### GOOD

```go
type User struct {
    Name  string
    Email string
    Age   int
}
```

If validation is required, expose a method that performs validation, not a setter that mutates:

```go
func (u *User) ChangeEmail(new string) error {
    if !strings.Contains(new, "@") {
        return errors.New("invalid email")
    }
    u.Email = new
    return nil
}
```

---

## Common Mistakes Beginners Make

| Mistake | Why it's bad | Fix |
|---|---|---|
| Wrap a single struct with a same-named interface | No abstraction value, doubles maintenance | Drop the interface; let consumer define it |
| Define `Animal`/`Shape`/`Vehicle` interfaces from a Java tutorial | Pseudo-OOP, inheritance thinking | Decompose by capability, define on the consumer side |
| Return interface from constructor by default | Locks API, hides struct methods | Return the concrete struct |
| Build a pile of `Get*` / `Set*` methods on an interface | JavaBean style | Use exported fields or behavioral methods |
| Declare `var err *MyErr` then `return err` | Typed-nil bug | Return literal `nil` |
| Define interface "just in case I want to mock it later" | Mock-driven design (see `middle.md`) | Wait for the second implementation |

---

## Symptoms of an Anti-Pattern

Use this list as a smell test on a code review:

- One package contains both an interface and exactly one implementation of it.
- An interface has the same name as a struct (`User` interface and `User` struct).
- An interface has more than 3-4 methods.
- An interface has no consumer that uses polymorphism — every call site casts back to the concrete type.
- A constructor returns the interface but the struct has additional public methods.
- The codebase has files named `mock_*.go` for every interface — and the only consumer is the test.
- A function returning `error` declares a typed pointer locally and returns it.

If two or more of those are true, you're in anti-pattern territory.

---

## Quick Refactor Recipes

### Recipe 1 — Strip a single-implementation interface

```go
// Before
type Repo interface { Save(...) error }
type pgRepo struct{}
func (r *pgRepo) Save(...) error { /* ... */ }
func New() Repo { return &pgRepo{} }

// After
type Repo struct{}
func New() *Repo { return &Repo{} }
func (r *Repo) Save(...) error { /* ... */ }
```

### Recipe 2 — Move the interface to the consumer

```go
// pkg storage  →  return the struct
package storage

type DB struct{ /* ... */ }
func (d *DB) Find(id string) (*User, error) { /* ... */ }

// pkg login  →  declare your own minimal need
package login

type userFinder interface {
    Find(id string) (*User, error)
}

type Service struct{ users userFinder }
```

### Recipe 3 — Replace getters with fields

```go
// Before
type User interface { GetName() string; SetName(string) }

// After
type User struct{ Name string }
```

### Recipe 4 — Fix the typed-nil bug

```go
// Before — returns typed nil
func parse(s string) error {
    var err *ParseError
    if invalid(s) {
        err = &ParseError{...}
    }
    return err  // BUG when err is nil
}

// After — explicit untyped nil
func parse(s string) error {
    if invalid(s) {
        return &ParseError{...}
    }
    return nil
}
```

---

## Test

### 1. Why does this print "oops" even though we returned `err`, which was nil?
```go
var err *MyError
return err  // function signature: error
```
- a) Bug in Go runtime
- b) The interface stores a non-nil type word
- c) Pointers are never nil
- d) `MyError` does not implement `error`

**Answer: b** — the interface holds (`*MyError`, nil) which is not equal to nil.

### 2. What is the rule "Accept interfaces, return structs" telling you?
- a) Always return interfaces
- b) Don't return interfaces from constructors when a struct is enough
- c) Never use interfaces
- d) Use interfaces only inside structs

**Answer: b**

### 3. When is a single-implementation interface justified?
- a) Always — it's good design
- b) Never
- c) When a real second implementation exists or is imminent
- d) Only in test code

**Answer: c**

### 4. The "Animal interface" pattern is bad because:
- a) Animals can't be Go types
- b) It mimics inheritance hierarchies that Go does not have
- c) Methods on structs are slow
- d) Interfaces can't be used with structs

**Answer: b**

### 5. The right replacement for `GetName()` / `SetName()` interfaces is:
- a) Two methods on a struct
- b) An exported field, plus behavioral methods if validation is needed
- c) Reflection
- d) `interface{}`

**Answer: b**

---

## Tricky Questions

**Q1: Is `var e error = (*MyError)(nil)` equal to `nil`?**
No. The interface value has a non-nil type word (`*MyError`). `e == nil` returns false.

**Q2: How do I assert in a test that an error is "really" nil?**
Use `errors.Is(err, nil)` — wait, that does NOT help, because `errors.Is` walks the chain. The reliable approach is to never produce a typed-nil error in the first place: declare the function as `error` and `return nil` literally.

**Q3: Is it ever right to define an interface in the same package as its only implementation?**
Yes — when the package is a library that publishes the interface as part of its public API for users to implement, e.g. `io.Reader`, `http.Handler`. But in application code, almost never.

**Q4: Can `Animal interface` ever be okay?**
Only when there is real polymorphism over speak/move/eat — e.g. an actual game engine. Even then, decomposition into `Speaker`, `Mover`, `Eater` is more idiomatic.

**Q5: Why is returning a struct strictly more flexible than returning an interface?**
A struct can be wrapped in any interface the caller chooses (the interface lives at the consumer side). An interface return value is fixed at the producer side and constrains everyone.

---

## Cheat Sheet

```
TYPED-NIL GOTCHA
─────────────────────────────────────────
Interface value = (type word, data word)
nil interface  = (nil, nil)
typed nil      = (T, nil)   ← != nil
Fix: return literal nil from a function returning error

PREMATURE ABSTRACTION
─────────────────────────────────────────
Rule: don't design with interfaces — discover them
Wait for the second implementation
"The bigger the interface, the weaker the abstraction"

INTERFACE LOCATION
─────────────────────────────────────────
"Accept interfaces, return structs"
Producer: return *Concrete
Consumer: declare minimal interface

OOP IMPORTS
─────────────────────────────────────────
NO Animal/Shape/Vehicle hierarchies
NO Get*/Set* interfaces
NO same-package mirror interfaces
NO "in case we want to mock it" interfaces
```

---

## Summary

The four anti-patterns to internalize at junior level:

1. **Typed-nil** — returning a typed pointer from an `error`-returning function produces a non-nil interface even when the pointer is nil. Always `return nil` literally.
2. **Premature abstraction** — don't introduce an interface until two implementations exist.
3. **Pseudo-OOP** — Go has no inheritance; resist `Animal`/`Shape` style hierarchies.
4. **Getter/setter interfaces** — Go has exported struct fields; use them instead of JavaBean-style boilerplate.

The middle level digs into mock-driven design, header interfaces, pointer-to-interface, and interface bloat. The senior level looks at the architectural cost of these patterns and how to refactor at scale.
