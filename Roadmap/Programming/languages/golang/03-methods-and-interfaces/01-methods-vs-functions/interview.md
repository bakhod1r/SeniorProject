# Methods vs Functions — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: What is the difference between a function and a method?

**Answer:** A function is an independent block of code, not attached to any type. A method, on the other hand, has a **receiver**: it is written in the form `func (r T) M()` and called as `value.M()`. The receiver indicates which type the method is attached to.

```go
func Add(a, b int) int { return a+b }   // function

type Calc struct{}
func (c Calc) Sum(a, b int) int { return a+b }   // method
```

### Q2: Where is the receiver written?

**Answer:** Between the `func` keyword and the method name, inside parentheses.

```go
func (receiver Type) MethodName(args) ReturnType { ... }
//   ─────receiver─────
```

### Q3: Can a method be added to the built-in `int` type?

**Answer:** No. You cannot add methods directly to built-in types. Create a new `defined type`:

```go
type MyInt int
func (m MyInt) Double() MyInt { return m * 2 }
```

### Q4: In which package must a method be written?

**Answer:** A method must be in the **same package** as its receiver's base type. You cannot add a method to a type from another package.

### Q5: What happens if a method does not return a value?

**Answer:** Nothing — Go allows functions and methods without a return type. There is no `void` keyword; simply omit the return type:

```go
func (l *Logger) Print(msg string) {
    fmt.Println(msg)
}
```

---

## Middle-Level Questions

### Q6: What is the difference between value and pointer receivers?

**Answer:**

| Property | `func (t T)` (value) | `func (t *T)` (pointer) |
|-----------|---------------------|-------------------------|
| Copy made | Yes | No (pointer is passed) |
| Affects original | No | Yes |
| Method set of | T and *T | Only *T |
| With mutex/sync | DANGEROUS | Correct |
| Speed (small type) | Fast | Comparable |
| Speed (large type) | Slower | Fast |

### Q7: What is a method set and when does it matter?

**Answer:** A method set is the collection of all methods belonging to a type. It is important for **interfaces** — an interface match only succeeds if the method set fits.

```go
type Inc interface { Inc() }
type C struct{}
func (c *C) Inc() {}

var c C
// var _ Inc = c   // ERROR — C's method set does not contain Inc()
var _ Inc = &c    // OK — *C's method set contains Inc()
```

### Q8: Why does `m["k"].Inc()` (where `m` is `map[string]T`) not work?

**Answer:** Map elements are **not addressable**. A pointer receiver method requires `&m["k"]`, which is not allowed. Solution:

```go
v := m["k"]
v.Inc()
m["k"] = v
```

### Q9: What is the difference between a method value and a method expression?

**Answer:**
- **Method value** (`g.Hello`) — the receiver `g` is bound; type is `func() string`.
- **Method expression** (`Greeter.Hello`) — the receiver becomes the first argument; type is `func(Greeter) string`.

```go
g := Greeter{name: "Alice"}
v := g.Hello       // method value
e := Greeter.Hello // method expression

v()                 // "Hi, Alice"
e(g)                // "Hi, Alice"
```

### Q10: How does method promotion work via embedding?

**Answer:** Methods of the embedded type are "promoted" to the outer type. The outer type uses those methods as if they were its own.

```go
type Base struct{ ID string }
func (b Base) Identify() string { return b.ID }

type User struct{ Base }
u := User{Base: Base{ID: "u1"}}
fmt.Println(u.Identify()) // u1 — Base.Identify promoted
```

---

## Senior-Level Questions

### Q11: When does a method value escape to the heap?

**Answer:** When you create a method value, Go captures the receiver inside a closure. If that closure is passed to a goroutine, stored in a slice/map, or returned from a function — the receiver also escapes to the heap.

```go
func register(handlers map[string]func()) {
    s := &Service{}
    handlers["x"] = s.Handle  // s escapes to heap
}
```

You can verify this with `go build -gcflags='-m'`.

### Q12: Mixing pointer and value receivers on the same type — good or bad?

**Answer:** In most cases, **bad**. The method set becomes inconsistent and callers can get confused. Solution:
- If the type is small and immutability is required — make all methods value receivers.
- If the type's state must change or it contains a sync primitive — make all methods pointer receivers.

In the standard library you sometimes see mixed usage (for example, `bytes.Buffer.String()` is a value receiver while the rest are pointer receivers), but those are special cases.

### Q13: What is the difference between a method on a generic type and a package-level generic function?

**Answer:** A method on a generic type can use the receiver's type parameters but **cannot add its own type parameters**. A package-level function can be generic over any parameters.

```go
type List[T any] struct{ items []T }
func (l *List[T]) Add(x T) { ... }   // OK

// ERROR
// func (l *List[T]) Map[U any](f func(T) U) *List[U] { ... }

// Correct
func Map[T, U any](l *List[T], f func(T) U) *List[U] { ... }
```

This restriction is a deliberate decision in Go's generics design.

### Q14: In what situations does the difference between static and dynamic dispatch matter?

**Answer:**
- **Static dispatch** — a direct method call. The compiler knows which method is being called. Inlining is possible, and it is faster.
- **Dynamic dispatch** — a method call through an interface. The method pointer is found at runtime via `itab`. Useful for polymorphism, but slightly slower.

Using interfaces in a hot loop can reduce performance. Profile first.

### Q15: How do you decide between a function and a method?

**Answer:**
- **Pure utility** (no state, no side effects) → function
- **Domain entity behavior** → method
- **Stateful service** (with DI) → struct + methods
- **Helper for a type from another package** → function (no other choice)
- **Polymorphism needed** → method (for an interface)
- **Constructor** → function (`NewX(...)`)

---

## Tricky / Curveball Questions

### Q16: What does the following code print?
```go
type T struct{ n int }
func (t T) Inc() { t.n++ }

x := T{n: 5}
x.Inc()
fmt.Println(x.n)
```
- a) 6
- b) 5
- c) 0
- d) Compile error

**Answer: b — 5**

`Inc` is a value receiver — `t` is a copy of `x`. `t.n++` only modifies the copy. The original `x` is unaffected.

### Q17: What does the following code print?
```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

x := T{n: 5}
x.Inc()
fmt.Println(x.n)
```
- a) 6
- b) 5
- c) Compile error
- d) Panic

**Answer: a — 6**

Go automatically takes `&x`. The pointer receiver modifies the original `x`.

### Q18: What does the following code do?
```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

m := map[string]T{"k": {n: 1}}
m["k"].Inc()
```
- a) m["k"].n = 2
- b) m["k"].n = 1
- c) Compile error
- d) Runtime panic

**Answer: c — Compile error**

`m["k"]` is not addressable. A pointer receiver method cannot be called on it.

### Q19: Can a method be called on a nil pointer?

**Answer:** Yes, as long as the method does not dereference the receiver.

```go
type Logger struct{}
func (l *Logger) IsEnabled() bool { return l != nil }

var l *Logger
fmt.Println(l.IsEnabled()) // false — no panic
```

But if you access `l.field` or call `l.method()` (inside the method) — panic.

### Q20: Which of the following methods compile?
```go
type T int
type S = T

func (t T) A() {}      // 1
func (s S) B() {}      // 2
func (i int) C() {}    // 3
func (p *T) D() {}     // 4
```
- a) Only 1
- b) 1 and 4
- c) 1, 2, 4
- d) All

**Answer: b — 1 and 4**

- 1: T is a defined type — OK
- 2: S is an alias (with the `=` sign) — methods cannot be added
- 3: int is built-in — methods cannot be added
- 4: *T — pointer receiver, T is a defined type — OK

---

## Coding Tasks

### Task 1: Implement a Counter

```go
// Write: SafeCounter — concurrent-safe
// API: Inc(), Dec(), Value() int
```

**Solution:**

```go
import "sync"

type SafeCounter struct {
    mu sync.Mutex
    n  int
}

func (c *SafeCounter) Inc()       { c.mu.Lock(); defer c.mu.Unlock(); c.n++ }
func (c *SafeCounter) Dec()       { c.mu.Lock(); defer c.mu.Unlock(); c.n-- }
func (c *SafeCounter) Value() int { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

### Task 2: Implement the Stringer interface

```go
type Status int
const (
    Pending Status = iota
    Active
    Closed
)

// Write String() for Status
```

**Solution:**

```go
func (s Status) String() string {
    switch s {
    case Pending: return "pending"
    case Active:  return "active"
    case Closed:  return "closed"
    }
    return "unknown"
}

// fmt.Println(Active) → "active"
```

### Task 3: Builder pattern via method chaining

```go
// Write SQLBuilder:
// b.Select("name").From("users").Where("active = true").Build()
```

**Solution:**

```go
type SQLBuilder struct{ parts []string }

func (b *SQLBuilder) Select(cols ...string) *SQLBuilder {
    b.parts = append(b.parts, "SELECT "+strings.Join(cols, ", "))
    return b
}
func (b *SQLBuilder) From(t string) *SQLBuilder {
    b.parts = append(b.parts, "FROM "+t)
    return b
}
func (b *SQLBuilder) Where(c string) *SQLBuilder {
    b.parts = append(b.parts, "WHERE "+c)
    return b
}
func (b *SQLBuilder) Build() string {
    return strings.Join(b.parts, " ")
}
```

### Task 4: Dispatch table using method expressions

```go
// Write Calculator — operation chosen via method expression
```

**Solution:**

```go
type Calculator struct{}
func (Calculator) Add(a, b int) int { return a+b }
func (Calculator) Sub(a, b int) int { return a-b }
func (Calculator) Mul(a, b int) int { return a*b }

var ops = map[string]func(Calculator, int, int) int{
    "+": Calculator.Add,
    "-": Calculator.Sub,
    "*": Calculator.Mul,
}

func Apply(op string, a, b int) int {
    var c Calculator
    return ops[op](c, a, b)
}
```

---

## System Design Style

### Q21: How do you organize the repository pattern?

**Answer:** Interface (port) + concrete struct (adapter). The service struct receives it via dependency injection.

```go
type UserRepo interface {
    Find(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

type pgUserRepo struct{ db *sql.DB }
func (r *pgUserRepo) Find(...) ...
func (r *pgUserRepo) Save(...) ...

type UserService struct{ repo UserRepo }
func (s *UserService) Register(...) ...
```

A mock implementation for testing is easy — provided you have an interface.

### Q22: How is the decorator pattern implemented in Go?

**Answer:** A new struct embeds the interface and overrides the method in place.

```go
type LoggingRepo struct{ inner UserRepo }
func (l *LoggingRepo) Find(ctx context.Context, id string) (*User, error) {
    log.Println("finding user", id)
    return l.inner.Find(ctx, id)
}
```

### Q23: When to choose functional options vs the builder pattern?

**Answer:**
- **Functional options** — simple configuration, idiomatic Go.
- **Builder method chain** — complex configuration, validation, conditional logic.

The standard library favors functional options. However, the `flag` package uses a builder-style approach.

---

## What Interviewers Look For

### Junior

- Can explain the difference between function and method
- Can write method syntax
- Knows methods cannot be added to built-in types
- Understands the `value.M()` call

### Middle

- Knows the rules of method sets
- Can justify the choice between value and pointer receivers
- Understands the difference between method value and method expression
- Understands embedding promotion
- Knows the `m["k"].M()` problem

### Senior

- Justifies the choice between method/function from an architectural standpoint
- Understands static vs dynamic dispatch and escape consequences
- Knows the importance of pointer receivers in concurrent contexts
- Understands the limits of generics combined with methods
- Knows the rules around public API stability and breaking changes

### Professional

- Can consistently choose methods within a domain-driven design context
- Can justify library design decisions (functional options, builder)
- Can adopt tooling (`go vet`, `staticcheck`, `revive`) as a team standard
- Knows migration strategies (breaking vs non-breaking)

---

## Cheat Sheet

```
FREQUENTLY ASKED INTERVIEW TOPICS
─────────────────────────────────────────
1. Function vs method difference
2. Value vs pointer receiver choice
3. Method set and interface match
4. Pointer receiver problem on map elements
5. Method value escape
6. Embedding and method promotion
7. Generic method limitations
8. Public API breaking change rules

THINGS NOT TO SAY IN ANSWERS
─────────────────────────────────────────
- "Methods are faster" — no, same speed
- "Method = OOP" — no, just a function with a receiver
- "Pointer is always faster" — no, copying is faster for small types
- "Get-prefix is idiomatic" — no, in Go it is `Name()` (without Get)

CODING ANSWERS
─────────────────────────────────────────
- Receiver name — 1-2 letters
- One type — one receiver name
- With a mutex — pointer receiver
- Constructor — `NewX(...)`
```
