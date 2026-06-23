# Interfaces Basics — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Interface Internals](#interface-internals)
3. [Itab Caching and Performance](#itab-caching-and-performance)
4. [Interface Design Principles](#interface-design-principles)
5. [Liskov Substitution and Interfaces](#liskov-substitution-and-interfaces)
6. [Composition Strategies](#composition-strategies)
7. [Type Assertion vs Type Switch](#type-assertion-vs-type-switch)
8. [Generic Type Parameters vs Interfaces](#generic-type-parameters-vs-interfaces)
9. [Refactoring Toward Interfaces](#refactoring-toward-interfaces)
10. [Anti-patterns](#anti-patterns)
11. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the senior level, interface design moves beyond surface appearance into internal mechanics:
- Interface internals and the dispatch mechanism
- Itab cache and performance
- Interface design principles (ISP, LSP)
- Generics vs interface trade-offs
- Production-grade refactoring

---

## Interface Internals

### Interface value memory layout

An interface value is 16 bytes on a 64-bit platform:

```
                   ┌──────────────────────┬──────────────────────┐
                   │      tab pointer     │      data pointer    │
                   └──────────────────────┴──────────────────────┘
                          (8 bytes)              (8 bytes)
```

- **Tab pointer** — points to the itab struct (interface type + concrete type + methods)
- **Data pointer** — points to the concrete value

### Itab struct (Go runtime)

```go
// runtime/iface.go (simplified)
type itab struct {
    inter *interfacetype  // interface type
    _type *_type          // concrete type
    hash  uint32          // _type.hash for type switch
    _     [4]byte
    fun   [1]uintptr      // methods (variadic)
}
```

`fun` stores the concrete type's methods in interface order.

### Eface (empty interface)

`interface{}` (or `any`) stores only 2 words:

```go
type eface struct {
    _type *_type
    data  unsafe.Pointer
}
```

There is no methods array — no itab is needed.

### Boxing

When a concrete value is assigned to an interface:
- **Pointer/reference type** — the pointer is stored directly
- **Value type (struct, int, etc.)** — a copy is allocated on the heap (boxing)

```go
var x int = 42
var i interface{} = x   // 42 is moved to the heap
```

This can be inspected with `go build -gcflags='-m'`.

### Inspection via `unsafe`

```go
import "unsafe"

type iface struct {
    tab  uintptr
    data uintptr
}

var i fmt.Stringer = User{Name: "Alice"}
ip := (*iface)(unsafe.Pointer(&i))
fmt.Printf("tab=%x data=%x\n", ip.tab, ip.data)
```

(For learning purposes only — avoid `unsafe` in production.)

---

## Itab Caching and Performance

### Itab is cached

The first time `var i I = T{}` is executed, an itab is created and cached (interface type + concrete type combination).

Subsequent assignments use the itab directly.

### Method calls on the hot path

```go
var i I = concreteValue
for i := 0; i < 1e6; i++ {
    i.Method()  // dynamic dispatch — itab.fun[0]
}
```

Typical cost: 1–3 ns/op (when in CPU cache).

### Bench: static vs dynamic

```go
type I interface { M() }

type T struct{}
func (t *T) M() {}

func BenchmarkStatic(b *testing.B) {
    t := &T{}
    for i := 0; i < b.N; i++ { t.M() }
}

func BenchmarkInterface(b *testing.B) {
    var i I = &T{}
    for i := 0; i < b.N; i++ { i.M() }
}
```

Typical results:
- Static: ~0.5 ns/op
- Interface: ~2 ns/op

3–4x slower, but rarely noticeable in most cases.

### Inlining is broken

An interface call hides the concrete type from the compiler, which means it cannot inline the method body.

---

## Interface Design Principles

### ISP — Interface Segregation Principle

> "Clients should not be forced to depend upon interfaces that they do not use."

```go
// Bad — large interface
type Storage interface {
    Read(...)
    Write(...)
    Delete(...)
    List(...)
    Backup(...)
    Restore(...)
}

// Good — small interfaces
type Reader interface { Read(...) ... }
type Writer interface { Write(...) ... }
type Deleter interface { Delete(...) ... }

// Caller uses only the interface it needs
func ProcessReadOnly(r Reader) { ... }
```

### LSP — Liskov Substitution

When a concrete type is substituted for an interface, the semantics must not be broken.

```go
// Good — every Stringer implementation is predictable
type Stringer interface { String() string }

// Bad — implementation panics
type BadReader struct{}
func (b BadReader) Read(p []byte) (int, error) {
    panic("not implemented")  // LSP violated
}
```

### Declare interfaces on the caller side

```go
// Producer package
package storage
type Repo struct{ db *sql.DB }
func (r *Repo) Find(id string) (*User, error) { ... }

// Consumer package
package handler

type UserFinder interface {
    Find(id string) (*User, error)
}

type Handler struct{ repo UserFinder }
```

The consumer declares its own interface. The producer returns a concrete type. Implicit satisfaction wires them together.

### Accept interface, return concrete

```go
// Good
func NewService(logger Logger) *Service { ... }   // Service is concrete
func (s *Service) Logger() Logger { return s.logger }  // OK — getter

// Bad
func NewLogger() Logger { ... }  // Hides the concrete type
```

Returning a concrete type gives callers more flexibility.

---

## Liskov Substitution and Interfaces

### LSP violations

```go
type Reader interface { Read([]byte) (int, error) }

// LSP-violating
type LimitedReader struct{}
func (LimitedReader) Read(p []byte) (int, error) {
    if len(p) > 10 { panic("too big") }   // semantics broken
    // ...
}
```

The caller expects the semantics of `Reader.Read` — it does not expect a panic for a `len(p)` constraint.

### Documentation as contract

```go
// Read reads up to len(p) bytes into p.
// It returns the number of bytes read (0 <= n <= len(p))
// and any error encountered. Even if Read returns n < len(p),
// it may use all of p as scratch space during the call.
func (r *Reader) Read(p []byte) (n int, err error) { ... }
```

The interface contract is written in the documentation. Implementations must comply with it.

---

## Composition Strategies

### Embedding interfaces — granularity

```go
type Reader interface { Read(...) ... }
type Writer interface { Write(...) ... }
type ReadWriter interface { Reader; Writer }
type ReadWriteCloser interface { Reader; Writer; Closer }
```

Granular interfaces compose into larger ones.

### Adding to an interface — breaking?

```go
// v1
type Reader interface { Read(...) ... }

// v2
type Reader interface {
    Read(...) ...
    ReadAt(...) ...   // NEW — all implementations broken
}
```

Adding a new method is BREAKING. Create a new interface instead:

```go
type ReaderAt interface { ReadAt(...) ... }
```

The caller uses either `Reader` or `ReaderAt`.

### `interface{}` constraint (Go 1.18+ — `any`)

```go
type Container struct{ items []any }

func (c *Container) Add(x any) { c.items = append(c.items, x) }
```

The empty interface accepts any type. However, you must use a type assertion to check the type.

### Constraint interface (Go 1.18+ generics)

```go
type Number interface {
    int | int64 | float64
}

func Sum[T Number](xs []T) T { ... }
```

A constraint interface can also be written with `~int` (underlying type):

```go
type Numeric interface {
    ~int | ~int64 | ~float64
}
```

---

## Type Assertion vs Type Switch

### Type assertion

```go
var i I = concreteValue

c, ok := i.(*ConcreteType)
if !ok {
    // not the type
}
```

### Type switch

```go
switch v := i.(type) {
case *T1:
    // v is *T1
case *T2:
    // v is *T2
default:
    // unknown
}
```

Details are covered in separate sections. At the senior level, interface design avoids type assertions and instead expresses polymorphism through interface methods.

---

## Generic Type Parameters vs Interfaces

### Old style — polymorphism via interface

```go
type Numeric interface {
    Add(other Numeric) Numeric
}

type Int int
func (i Int) Add(other Numeric) Numeric { return i + other.(Int) }
```

Type assertion and boxing are required.

### New style — generics

```go
type Number interface { int | float64 }

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs { total += x }
    return total
}
```

Faster, type-safe, no boxing.

### Which to choose?

| Situation | Choice |
|---------|--------|
| Run-time polymorphism (different concrete types) | Interface |
| Compile-time generic algorithm | Generics |
| Heterogeneous collection | Interface (`[]any` or specific) |
| Same algorithm, different types | Generics |

---

## Refactoring Toward Interfaces

### Step 1: Concrete dependency

```go
// Before
type Service struct{ db *PgDB }
func (s *Service) GetUser(id string) (*User, error) {
    return s.db.Query(...)
}
```

### Step 2: Extract interface

```go
// After
type UserStore interface {
    GetUser(id string) (*User, error)
}

type Service struct{ store UserStore }
func (s *Service) GetUser(id string) (*User, error) {
    return s.store.GetUser(id)
}
```

### Step 3: Concrete satisfies interface

```go
type PgDB struct{ ... }
func (db *PgDB) GetUser(id string) (*User, error) { ... }

// Use
service := &Service{store: pgDB}
```

### Step 4: Add mock for testing

```go
type MockStore struct{ users map[string]*User }
func (m *MockStore) GetUser(id string) (*User, error) {
    if u, ok := m.users[id]; ok { return u, nil }
    return nil, errors.New("not found")
}
```

---

## Anti-patterns

### 1. Interface bloat

```go
// Bad — 20+ methods
type FullService interface { ... }
```

This violates ISP. Split into smaller interfaces.

### 2. Premature interface

```go
// Bad — only one concrete exists, future ones unknown
type Calculator interface { Add(int, int) int }

type SimpleCalc struct{}
func (SimpleCalc) Add(a, b int) int { return a + b }
```

Start with a concrete type — introduce an interface when you actually need one.

### 3. Returning an interface

```go
// Bad — usually
func NewService() Service { ... }   // Service is an interface

// Good
func NewService() *ServiceImpl { ... }
```

If the caller starts with a concrete type, it can assign to an interface when needed.

### 4. Big "Service" interface

```go
// Bad
type UserService interface {
    Create(...)
    Find(...)
    Update(...)
    Delete(...)
    List(...)
    Authenticate(...)
    SendEmail(...)
    GenerateReport(...)
}
```

This is called a "god interface". Split it into several smaller interfaces.

### 5. Interface as receiver

```go
// WRONG
func (i I) DoSomething() {}   // interface receiver — illegal
```

The method receiver must be a concrete type.

---

## Cheat Sheet

```
INTERFACE INTERNALS
────────────────────────
Interface = (itab, data)
itab = (type, methods)
eface = (type, data) — for any/interface{}

ISP — small interface
LSP — substitution semantics
DI — accept interface, return concrete

DESIGN PRINCIPLES
────────────────────────
Interface on the caller side
Producer returns concrete
Compile-time: var _ I = (*T)(nil)
No premature abstraction
Granular interfaces via composition

DISPATCH
────────────────────────
Static (concrete) — 0.5 ns
Dynamic (interface) — 2 ns
Inlining is broken — interface call

GENERIC vs INTERFACE
────────────────────────
Run-time polymorphism → interface
Compile-time algorithm → generics
Same algo, different types → generics

ANTI-PATTERNS
────────────────────────
Interface bloat (20+ methods)
Premature interface
Returning an interface
God interface
Big Service interface
```

---

## Summary

Interfaces at the senior level:
- Internals — itab, data ptr, eface
- Performance — itab cache, loss of inlining
- Design — ISP, LSP, caller-side declaration
- Composition — granular interfaces, embedding
- Generics vs interface — which to choose
- Refactoring — concrete → interface → mock

The interface is Go's most powerful tool. At the senior level, using it as a team standard and architectural decision means writing code that can keep working for the next 5+ years.
