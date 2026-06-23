# Methods vs Functions — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Method Set Theory](#method-set-theory)
3. [Receiver Selection](#receiver-selection)
4. [Auto-addressability and Auto-dereferencing](#auto-addressability-and-auto-dereferencing)
5. [Method Values and Method Expressions](#method-values-and-method-expressions)
6. [Method on Non-Struct Types](#method-on-non-struct-types)
7. [Methods and Defined Type Rules](#methods-and-defined-type-rules)
8. [Function as a First-Class Citizen](#function-as-a-first-class-citizen)
9. [When Function is Better than Method](#when-function-is-better-than-method)
10. [Patterns and Anti-Patterns](#patterns-and-anti-patterns)
11. [Performance Implications](#performance-implications)
12. [Code Review Checklist](#code-review-checklist)
13. [Test](#test)
14. [Tricky Questions](#tricky-questions)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you learned the syntactic difference between a function and a method. At the middle level **deeper** topics begin:

- How receiver choice (value vs pointer) affects the **method set**
- When Go automatically takes `&value` or `*pointer`
- Storing a method as a value (method value) and dispatching it (method expression)
- What the choice between function and method means for **software architecture**

This file unpacks these nuances with real examples.

---

## Method Set Theory

**Method set** — the collection of all methods a type owns. The method set is fundamental to Go's **interface** mechanism.

### Method set rules for type T

| Receiver | Method set of `T` | Method set of `*T` |
|----------|-------------------|-------------------|
| `func (t T) M()` | `M` is in | `M` is in |
| `func (t *T) M()` | `M` is **not in** | `M` is in |

Example:

```go
type Counter struct{ n int }

func (c Counter)  Get() int { return c.n }
func (c *Counter) Inc()     { c.n++ }
```

| Type | Get() visible? | Inc() visible? |
|-----|------------------|------------------|
| `Counter` | yes | no |
| `*Counter` | yes | yes |

Why does this matter? For interface matching:

```go
type Incrementer interface {
    Inc()
}

var c Counter = Counter{}
// var _ Incrementer = c  // ERROR — Counter does not satisfy Incrementer
var _ Incrementer = &c    // OK — *Counter satisfies it
```

### The reason behind this rule

A pointer receiver method mutates the original value. If Go silently took `&c` for you when passing a `Counter` value to an interface, you'd be calling a method on a **temporary copy** without realizing it. So the Go rule is: **interface match through a pointer receiver is only possible via an addressable value**.

---

## Receiver Selection

### When to use a value receiver?

```go
func (p Point) DistanceTo(q Point) float64 { ... }
```

Use a value receiver if **at least one** of these holds:
1. The type is small (8-16 bytes) and copying is cheap
2. The method does not mutate (read-only)
3. The type must be immutable (like a built-in alias: `time.Duration`, `Currency`)
4. The type has value semantics like a primitive or array

### When to use a pointer receiver?

```go
func (c *Counter) Inc() { c.n++ }
```

Use a pointer receiver if at least one of these holds:
1. The method mutates the type (mutating)
2. The type is large — copying every time is expensive
3. The type contains a sync primitive (mutex, atomic) — copying is wrong
4. Consistent style: if any method on the type uses a pointer receiver, make them all pointers

### Don't mix them

```go
// BAD
type User struct{ name string }
func (u User)   Name() string { return u.name }    // value
func (u *User)  SetName(n string) { u.name = n }   // pointer
```

Technically this compiles, but the **method set** becomes confusing. Better: make them all pointers or all values. If there is mutation — use pointers.

---

## Auto-addressability and Auto-dereferencing

Go performs **automatic conversion** for method calls:

### Calling a pointer method on a value

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

c := C{}
c.Inc()       // Go auto-converts: (&c).Inc()
```

**However**: only if `c` is **addressable**! Map values are NOT addressable:

```go
m := map[string]C{"a": {}}
m["a"].Inc()  // ERROR: cannot take address of m["a"]
```

The correct way:

```go
v := m["a"]
v.Inc()
m["a"] = v
```

### Calling a value method on a pointer

```go
type C struct{ n int }
func (c C) Get() int { return c.n }

p := &C{n: 5}
p.Get()       // Go auto-converts: (*p).Get()
```

This always works (because dereferencing does not require addressability).

### Diagram

```
                    method receiver type
                    ┌──────────┬──────────┐
                    │   T      │   *T     │
        ┌───────────┼──────────┼──────────┤
   v as │ T (value) │ ok       │ ok* (auto│
        │           │          │   &v)    │
        ├───────────┼──────────┼──────────┤
   v *T │ *T (ptr)  │ ok (auto │ ok       │
        │           │  *v)     │          │
        └───────────┴──────────┴──────────┘

* only if addressable
```

---

## Method Values and Method Expressions

### Method value

A method can be stored **as a value**:

```go
type Greeter struct{ name string }
func (g Greeter) Hello() string { return "Hi, " + g.name }

g := Greeter{name: "Alice"}
hi := g.Hello   // method VALUE — receiver is "bound"
fmt.Println(hi()) // Hi, Alice
```

`hi` is effectively a function of type `func() string` — the receiver `g` has been bound to it.

### Method expression

A method can also be obtained at the **type level**:

```go
hello := Greeter.Hello   // method EXPRESSION
fmt.Println(hello(g))    // Hi, Alice
```

The type of `hello` is `func(Greeter) string`. The receiver becomes the first argument.

### Usage

```go
type Op func(int, int) int

type Calculator struct{}

func (Calculator) Add(a, b int) int { return a + b }
func (Calculator) Sub(a, b int) int { return a - b }

func main() {
    var c Calculator
    ops := map[string]Op{
        "+": c.Add,  // method values
        "-": c.Sub,
    }
    fmt.Println(ops["+"](2, 3)) // 5
}
```

---

## Method on Non-Struct Types

Methods are not just for structs — you can attach them to **any defined type**:

```go
// Slice type
type IntSlice []int
func (s IntSlice) Sum() int {
    total := 0
    for _, v := range s {
        total += v
    }
    return total
}

// Function type
type Handler func(string) string
func (h Handler) Wrap() Handler {
    return func(s string) string {
        return "[" + h(s) + "]"
    }
}

// Map type
type Counts map[string]int
func (c Counts) Total() int {
    total := 0
    for _, v := range c {
        total += v
    }
    return total
}

// Channel type
type Bus chan string
func (b Bus) Send(msg string) { b <- msg }
```

This is one of Go's powerful features — you can build your own behavior on top of any type in the language.

---

## Methods and Defined Type Rules

### Rule 1: You cannot add methods to a type alias

```go
type IntAlias = int   // alias (with =)
// func (i IntAlias) Double() IntAlias { ... }  // ERROR

type IntDefined int    // defined type (no =)
func (i IntDefined) Double() IntDefined { return i * 2 } // OK
```

`type X = Y` (alias) — a new name for Y.
`type X Y` (defined) — derived from Y, but a separate type.

### Rule 2: Cross-package methods are not allowed

```go
// time.Time is in another package
// func (t time.Time) IsLeap() bool { ... }  // ERROR

// Use a wrapper
type LeapAware struct{ time.Time }
func (l LeapAware) IsLeap() bool { ... }
```

### Rule 3: Method names must be unique within a type

```go
type X struct{}
func (X) Foo() {}
// func (X) Foo() {}  // ERROR: redeclared
```

---

## Function as a First-Class Citizen

In Go, a function is a **first-class citizen**: it can be assigned to a variable, passed as an argument, or returned:

```go
// Function as a variable
add := func(a, b int) int { return a + b }
fmt.Println(add(2, 3)) // 5

// Function as an argument
func apply(op func(int, int) int, a, b int) int {
    return op(a, b)
}
fmt.Println(apply(add, 2, 3)) // 5

// Returning a function
func multiplier(n int) func(int) int {
    return func(x int) int { return x * n }
}
double := multiplier(2)
fmt.Println(double(7)) // 14
```

A method can play the same role in the form of a `method value`.

---

## When Function is Better than Method

### Situation 1: A common operation across multiple types

```go
// BAD — a method on each type
func (a Apple) ToJSON() ([]byte, error)
func (b Banana) ToJSON() ([]byte, error)

// GOOD — generic function (1.18+)
func ToJSON[T any](v T) ([]byte, error) {
    return json.Marshal(v)
}
```

### Situation 2: A pure mathematical operation

```go
// BAD
func (n Number) Min(other Number) Number { ... }

// GOOD
func Min(a, b Number) Number { ... }
```

### Situation 3: A utility that doesn't belong to a type

```go
// BAD
func (s String) Reverse() String { ... }  // unnatural

// GOOD — package-level function
func Reverse(s string) string { ... }
```

### Situation 4: Stateless validator

```go
// GOOD — function
func ValidateEmail(email string) error { ... }

// No need to make it a method if there is no state
```

---

## Patterns and Anti-Patterns

### Pattern: Constructor + behavior

```go
type Server struct{ port int }

func NewServer(port int) *Server { return &Server{port: port} }
func (s *Server) Start() error { ... }
func (s *Server) Stop() error { ... }
```

### Pattern: Builder method-chain

```go
type Query struct{ parts []string }

func (q *Query) Where(c string) *Query { q.parts = append(q.parts, "WHERE "+c); return q }
func (q *Query) Limit(n int) *Query    { q.parts = append(q.parts, fmt.Sprintf("LIMIT %d", n)); return q }
```

### Anti-pattern: God object

```go
// Bad — User knows about everything
type User struct{}
func (u User) SaveToDB() error { ... }
func (u User) SendEmail(to string) error { ... }
func (u User) GenerateReport() error { ... }
```

Better: separate `UserRepository`, `EmailService`, `ReportGenerator`.

### Anti-pattern: Method that does not use the receiver

```go
// Bad — receiver is unused, this should not be a method
func (u User) Add(a, b int) int { return a + b }

// Good
func Add(a, b int) int { return a + b }
```

---

## Performance Implications

### Methods and functions have the same speed

```go
// Both compile to the same machine code
func Area(r Rectangle) float64    { return r.W * r.H }
func (r Rectangle) Area() float64 { return r.W * r.H }
```

### Speed of value vs pointer receivers

| Receiver | Stack? | Heap escape? | Speed |
|----------|--------|--------------|--------|
| `(c C)` (small C) | Copy on stack | No | Fast |
| `(c *C)` | Pointer | Possibly | Depends |
| `(c C)` (large C) | Large copy | Often | Slower |

**Rules:**
- Small (≤16 bytes) struct — value receiver
- Large struct — pointer receiver
- Sync primitive — always pointer

### Inlining

The compiler may inline small methods:

```go
//go:noinline is not needed — the compiler decides on its own
func (p Point) X() int { return p.x } // probably inlined
```

---

## Code Review Checklist

When reviewing methods/functions, check the following:

- [ ] Is the receiver actually used (if not — make it a function)
- [ ] Is value vs pointer receiver chosen correctly
- [ ] Is the receiver style consistent within a type
- [ ] Is the receiver name short and consistent (`u`, `r`, `c`)
- [ ] Does the method name avoid repeating the type (`User.UserName` — bad)
- [ ] Are there attempts to define cross-package methods (there should not be)
- [ ] Does the constructor follow the `NewX(...)` pattern
- [ ] Is the method actually pure logic (should it be a function instead)

---

## Test

### 1. What happens with the method set in the following code?
```go
type X struct{}
func (x X)  A() {}
func (x *X) B() {}

var v X
var p *X = &v

type I interface { A(); B() }
var _ I = v   // ?
var _ I = p   // ?
```
- a) Both are OK
- b) The first is an error, the second is OK
- c) Both are errors
- d) The first is OK, the second is an error

**Answer: b** — `B()` is not in the method set of `X`, but it is in `*X`.

### 2. What does `m["x"].Inc()` produce (where `m` is `map[string]Counter` and `Inc` has a pointer receiver)?
- a) Works, m["x"] is updated
- b) Works, m["x"] is not updated
- c) Compile error: cannot take address
- d) Runtime panic

**Answer: c**

### 3. What is the type of the expression `Greeter.Hello` (given `func (g Greeter) Hello() string`)?
- a) `func() string`
- b) `func(Greeter) string`
- c) `Greeter`
- d) `string`

**Answer: b** — in a method expression the receiver becomes the first argument.

### 4. Which of the following is a **method value** (a method as a value)?
- a) `Greeter.Hello`
- b) `g.Hello`
- c) `Greeter.Hello(g)`
- d) `g.Hello()`

**Answer: b** — `g.Hello` (without parentheses) creates a method value.

### 5. Difference between defined type and alias regarding methods?
- a) No difference
- b) Methods cannot be added to defined types, but can be to aliases
- c) Methods can be added to defined types, but not to aliases
- d) Neither allows methods to be added

**Answer: c**

---

## Tricky Questions

**Q1: Can a pointer receiver method be called on `nil`?**
Yes, as long as the method does not dereference the receiver. Example:
```go
type Logger struct{ prefix string }
func (l *Logger) IsEnabled() bool { return l != nil }
var l *Logger = nil
fmt.Println(l.IsEnabled()) // false — no panic
```

**Q2: How can you turn a function into a method?**
Create a new defined type and attach it as a method:
```go
type StringOp func(string) string
func (op StringOp) Apply(s string) string { return op(s) }
```

**Q3: Can a method's return type be the receiver type?**
Yes — this is used for fluent APIs:
```go
func (q *Query) Where(...) *Query { return q }
```

**Q4: When is it acceptable to mix value and pointer receivers?**
The standard library sometimes does this (for example, `bytes.Buffer.String()` is a value receiver, while most of its methods are pointer receivers). But when writing **new code** — pick one and be consistent.

**Q5: When are methods added to an interface?**
Automatically, as soon as the method set fits. There is no `implements` keyword in Go — interface match is implicit.

---

## Cheat Sheet

```
METHOD SET RULES
────────────────────────────────────
Type T:    methods with (T) receiver
Type *T:   methods with (T) AND (*T) receivers

AUTO-CONVERSIONS
────────────────────────────────────
v.M()   → (&v).M()  [if M has pointer receiver and v is addressable]
p.M()   → (*p).M()  [if M has value receiver]
m["k"]  → NOT addressable, use a temporary variable

METHOD VALUE and EXPRESSION
────────────────────────────────────
g.Hello       → method value, type: func() string
Greeter.Hello → method expression, type: func(Greeter) string

NON-STRUCT METHODS
────────────────────────────────────
type IntSlice []int
func (s IntSlice) Sum() int { ... }

DEFINED vs ALIAS
────────────────────────────────────
type X = int   alias  → no methods can be added
type X int     defined → methods can be added
```

---

## Summary

Methods and functions differ in much more than syntax:

- **Method set** depends on the type and determines interface satisfaction.
- The choice of pointer vs value receiver changes the method set and the behavior.
- Go takes `&v`/`*p` automatically, but map values are not addressable.
- A method can be used as a value (method value) or as an expression (method expression).
- A method can be added to any defined type (struct, slice, map, function, channel).
- Choose a function for pure utilities; choose a method for state/behavior.

At the senior level we go deeper into using method values in callback strategies, building dispatch tables, and architectural decisions.

---

## Cheat Sheet — Quick Reference

| Situation | Solution |
|----------|--------|
| Type is small, immutable | value receiver |
| Type is large or contains sync | pointer receiver |
| You need to mutate the type | pointer receiver |
| Everything needs to be consistent | pick one style |
| Type from another package | wrapper struct |
| Built-in type | create a defined type |
| Pure logic | function |
| Stateful behavior | method |
