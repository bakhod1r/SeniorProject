# Interfaces Basics — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Implicit Satisfaction Mechanics](#implicit-satisfaction-mechanics)
3. [Method Set and Interface](#method-set-and-interface)
4. [Common Standard Interfaces](#common-standard-interfaces)
5. [Interface Composition](#interface-composition)
6. [Dispatch and Itab](#dispatch-and-itab)
7. [The Nil Interface Problem](#the-nil-interface-problem)
8. [Type Assertion (Brief)](#type-assertion-brief)
9. [Interface Design Tips](#interface-design-tips)
10. [Patterns](#patterns)
11. [Test](#test)
12. [Cheat Sheet](#cheat-sheet)

---

## Introduction

After learning the junior-level fundamentals, at the middle level we cover:
- Implicit satisfaction mechanics
- Method set rules and interfaces
- Common standard interfaces (Stringer, Reader, Writer, error)
- Interface composition
- Dispatch mechanism (itab)
- nil interface pitfalls

---

## Implicit Satisfaction Mechanics

### Compile-time check

The compiler compares the concrete type's method set against the interface's methods:

```go
type Greeter interface { Greet() string }

type Dog struct{ name string }
func (d Dog) Greet() string { return "woof" }

var g Greeter = Dog{}   // OK — Dog's method set has Greet
```

If the method set is incomplete — compile error.

### Implicit lock-in

If the interface changes (a new method is added), all implementations break (compile-time):

```go
// v1
type Reader interface { Read([]byte) (int, error) }

// v2 — breaking
type Reader interface {
    Read([]byte) (int, error)
    Close() error   // new
}
```

This is a strict rule of Go — all implementations must be updated.

### Compile-time assertion

Explicitly assert that a type satisfies an interface:

```go
var _ Reader = (*MyFile)(nil)
```

Here `_` is the blank identifier — the compiler checks it and it remains unused. If the type does not satisfy the interface — immediate compile error.

---

## Method Set and Interface

### Recap

| Receiver | T method set | *T method set |
|----------|--------------|---------------|
| `func (t T) M()` | ✅ | ✅ |
| `func (t *T) M()` | ❌ | ✅ |

### Example

```go
type Animal interface { Sound() string }

type Cat struct{}
func (c Cat) Sound() string { return "meow" }   // value receiver

var a Animal = Cat{}    // OK
var b Animal = &Cat{}   // OK

type Dog struct{}
func (d *Dog) Sound() string { return "woof" }  // pointer receiver

var c Animal = Dog{}    // ERROR — Dog's method set is incomplete
var d Animal = &Dog{}   // OK
```

### Mixed receivers — a difficulty

```go
type S struct{}
func (s S)  M1() {}    // value
func (s *S) M2() {}    // pointer

type I interface { M1(); M2() }

var _ I = S{}     // ERROR — M2 is not in the method set
var _ I = &S{}    // OK
```

Don't mix them, or require callers to use `*T`.

---

## Common Standard Interfaces

### `error`

```go
type error interface {
    Error() string
}
```

Example:

```go
type NotFoundError struct{ ID string }
func (e *NotFoundError) Error() string { return "not found: " + e.ID }
```

### `fmt.Stringer`

```go
type Stringer interface {
    String() string
}
```

`fmt.Println(x)` automatically calls `x.String()` (if it satisfies Stringer).

### `io.Reader`

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

For reading from a stream. EOF is the `io.EOF` error.

### `io.Writer`

```go
type Writer interface {
    Write(p []byte) (n int, err error)
}
```

### `io.Closer`

```go
type Closer interface {
    Close() error
}
```

### `sort.Interface`

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

### `json.Marshaler` / `json.Unmarshaler`

```go
type Marshaler interface { MarshalJSON() ([]byte, error) }
type Unmarshaler interface { UnmarshalJSON(data []byte) error }
```

---

## Interface Composition

### Embed interface

```go
type Reader interface { Read([]byte) (int, error) }
type Writer interface { Write([]byte) (int, error) }

type ReadWriter interface {
    Reader
    Writer
}
```

`ReadWriter`'s method set: `Read` + `Write`.

### Standard library composition

```go
type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

### Non-conflicting methods (Go 1.14+)

```go
type A interface { Foo() }
type B interface { Foo() }   // same signature

type AB interface { A; B }   // OK — only one Foo remains
```

Before Go 1.14 this was a compile error. Now, if the signatures are identical, it's OK.

### Signature mismatch in embedding

```go
type A interface { Foo() }
type B interface { Foo() string }   // different

type AB interface { A; B }   // compile error
```

If the signatures differ — error.

---

## Dispatch and Itab

### Interface value structure

An interface value is two words (16 bytes on 64-bit):

```
Interface value:
  ┌─────────────┬──────────────┐
  │  Type info  │  Data ptr    │
  └─────────────┴──────────────┘
```

- **Type info** — itab (interface table)
- **Data ptr** — concrete value (or its pointer)

### What is an itab?

The itab is the internal structure backing interface satisfaction:

```
itab {
    interface_type: I
    concrete_type:  *Dog
    methods: [Sound_func_ptr, Name_func_ptr]
}
```

The first time you do `var i I = d`, the itab is built and cached.

### Dispatch

```go
i.Sound()
```

Compiled code:
1. Read the `Sound` method ptr from the itab
2. Pass the data ptr as the receiver
3. Call the method ptr

This is **dynamic dispatch**. Typical cost: 1–3 ns/op.

### Static dispatch (with concrete type)

```go
d := Dog{}
d.Sound()   // static — the compiler knows the ptr directly
```

---

## The Nil Interface Problem

### The pitfall

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "err" }

func doit() error {
    var e *MyErr  // nil
    return e
}

err := doit()
fmt.Println(err == nil)   // false!
```

### Reason

`return e` — `e` is `*MyErr` (concrete type) with a `nil` value. The interface value is:

```
err = (type: *MyErr, value: nil)
```

The type is set — so the interface value is **NOT nil**. The interface is nil only if both are nil.

### Solution

```go
func doit() error {
    var e *MyErr
    if e == nil {
        return nil   // bare nil interface
    }
    return e
}
```

Or:

```go
func doit() (err error) {
    // err — already nil interface
    return
}
```

### `errors.Is` and `errors.As` (Go 1.13+)

```go
var notFound *NotFoundError

if errors.As(err, &notFound) {
    fmt.Println(notFound.ID)
}

if errors.Is(err, sql.ErrNoRows) { ... }
```

---

## Type Assertion (Brief)

### Syntax

```go
v, ok := i.(T)   // safe
v := i.(T)       // panic if mismatch
```

### Example

```go
var i interface{} = "hello"

s, ok := i.(string)
if ok { fmt.Println(s) }  // hello

n, ok := i.(int)          // ok = false, n = 0
```

(Detail: see the "Type Assertions" section.)

---

## Interface Design Tips

### Tip 1: Prefer small interfaces

```go
// Good
type Reader interface { Read([]byte) (int, error) }

// Bad
type FullStorage interface {
    Read(...) ...
    Write(...) ...
    Delete(...) ...
    List(...) ...
    Close(...) ...
}
```

A small interface is a strong abstraction.

### Tip 2: Define interfaces in the caller's package

```go
package consumer

type Repo interface { Find(id string) (*User, error) }

func NewService(r Repo) *Service { ... }

// Concrete type in the producer package
package storage
type PgRepo struct{ db *sql.DB }
func (r *PgRepo) Find(id string) (*User, error) { ... }
```

### Tip 3: Accept interfaces, return structs

```go
// Good
func NewService(logger Logger) *Service { ... }
// Service is concrete

// Bad (usually)
func NewLogger() Logger { ... }
// Logger is an interface, hides the concrete type
```

### Tip 4: Compile-time check

```go
var _ Reader = (*MyFile)(nil)   // assertion
```

### Tip 5: No premature interfaces

If there is only one concrete type and it's unclear whether others will appear — an interface is not needed.

---

## Patterns

### Pattern 1: Strategy

```go
type Sorter interface { Sort([]int) }

type QuickSort struct{}
func (QuickSort) Sort(xs []int) { ... }

type BubbleSort struct{}
func (BubbleSort) Sort(xs []int) { ... }

type Sortable struct{ algo Sorter }
func (s *Sortable) Run(xs []int) { s.algo.Sort(xs) }
```

### Pattern 2: Decorator

```go
type Logger interface { Log(string) }

type ConsoleLogger struct{}
func (c ConsoleLogger) Log(msg string) { fmt.Println(msg) }

type TimestampLogger struct{ inner Logger }
func (t TimestampLogger) Log(msg string) {
    t.inner.Log(time.Now().Format(time.RFC3339) + " " + msg)
}
```

### Pattern 3: Adapter

```go
type Reader interface { Read([]byte) (int, error) }

type StringReader struct{ s string; pos int }
func (r *StringReader) Read(p []byte) (int, error) {
    if r.pos >= len(r.s) { return 0, io.EOF }
    n := copy(p, r.s[r.pos:])
    r.pos += n
    return n, nil
}

// A string does not become an io.Reader automatically; an adapter does it
```

### Pattern 4: Mock for testing

```go
type Repo interface { Find(id string) (*User, error) }

type MockRepo struct {
    users map[string]*User
}
func (m *MockRepo) Find(id string) (*User, error) {
    if u, ok := m.users[id]; ok { return u, nil }
    return nil, errors.New("not found")
}

// Test
repo := &MockRepo{users: map[string]*User{"u1": {ID: "u1"}}}
service := NewService(repo)
```

---

## Test

### 1. What is required for a type to satisfy an interface?
**Answer:** The type's method set must cover all of the interface's methods.

### 2. What does `var _ I = (*T)(nil)` do?
**Answer:** A compile-time assertion — it checks whether `*T` satisfies interface I.

### 3. When does interface composition work?
**Answer:** Methods from embedded interfaces are added to the outer interface's method set. The same method with the same signature does not conflict (1.14+).

### 4. What is an itab?
**Answer:** Interface table — the structure inside an interface value. The concrete type and method pointers are stored there.

### 5. What is the nil interface problem?
**Answer:** Even if the concrete type is nil, the interface value becomes (type, nil) — not nil. You must return a bare `nil`.

---

## Cheat Sheet

```
IMPLICIT SATISFACTION
─────────────────────
If a type defines the methods → it satisfies the interface automatically
NO `implements` keyword
Compile-time check

METHOD SET
─────────────────────
T method set: value receivers
*T method set: value + pointer receivers
Pointer receiver method → only *T satisfies

STANDARD INTERFACES
─────────────────────
error          → Error() string
fmt.Stringer   → String() string
io.Reader      → Read([]byte) (int, error)
io.Writer      → Write([]byte) (int, error)
io.Closer      → Close() error
sort.Interface → Len, Less, Swap

COMPOSITION
─────────────────────
type RW interface { Reader; Writer }
Method conflicts allowed in 1.14+ (matching signatures)

ITAB
─────────────────────
Interface = (itab, data)
itab = (type, methods)
Dynamic dispatch — via the itab

NIL PITFALL
─────────────────────
var p *T = nil
var i I = p   // NOT nil
return nil    // bare nil

DESIGN TIPS
─────────────────────
Small interface (1–3 methods)
In the caller's package
Accept interface, return concrete
var _ I = (*T)(nil) check
No premature abstraction
```

---

## Summary

At the middle level, interfaces:
- Implicit satisfaction — checked at compile time
- Method set rules determine interface compatibility
- Standard interfaces — error, Stringer, Reader, Writer, Closer
- Interface composition — through embedding
- Itab — the dispatch mechanism
- nil interface pitfall — return bare `nil`

At the senior level we go deeper into interface internals and architectural concerns.
