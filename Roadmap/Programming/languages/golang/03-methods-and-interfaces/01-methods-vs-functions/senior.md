# Methods vs Functions — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural View](#architectural-view)
3. [Dispatch Mechanics](#dispatch-mechanics)
4. [Method Values, Closures, and Memory](#method-values-closures-and-memory)
5. [Method Expressions for Generic Dispatch](#method-expressions-for-generic-dispatch)
6. [Encapsulation Strategy](#encapsulation-strategy)
7. [Composition Over Inheritance](#composition-over-inheritance)
8. [Testing Strategies](#testing-strategies)
9. [Concurrency and Receiver Choice](#concurrency-and-receiver-choice)
10. [Generics + Methods](#generics-methods)
11. [Real-World Refactoring](#real-world-refactoring)
12. [Library Design Decisions](#library-design-decisions)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level the choice between method and function is no longer about syntax — it is an **architectural decision**. Every method:
- Exposes API surface
- Defines an ownership boundary
- Affects how the code is tested and mocked
- Influences concurrency and memory layout

This file looks at methods and functions in the context of an entire project.

---

## Architectural View

### Domain layer — methods

```go
// Domain entities — behavior in methods
type Order struct {
    ID    string
    Items []Item
    state OrderState
}

func (o *Order) AddItem(i Item) error {
    if o.state != Draft {
        return ErrFrozen
    }
    o.Items = append(o.Items, i)
    return nil
}

func (o *Order) Submit() error {
    if len(o.Items) == 0 {
        return ErrEmptyOrder
    }
    o.state = Submitted
    return nil
}
```

### Service layer — orchestration: usually methods (for DI)

```go
type CheckoutService struct {
    orders   OrderRepo
    payments PaymentGateway
    notify   Notifier
}

func (s *CheckoutService) Checkout(ctx context.Context, orderID string) error {
    order, err := s.orders.Find(ctx, orderID)
    if err != nil { return err }
    if err := s.payments.Charge(ctx, order.Total()); err != nil { return err }
    return s.notify.Send(ctx, order.UserID, "Order paid")
}
```

### Utility layer — functions

```go
// Pure helpers — function
package strutil

func TrimQuotes(s string) string { ... }
func Slugify(s string) string    { ... }
```

**Rule:** Domain behavior in methods, infrastructure dependencies in the method's struct (DI), pure logic in functions.

---

## Dispatch Mechanics

### Static dispatch (90% of cases)

Direct method calls are resolved at compile time:

```go
var o Order
o.Submit()  // static dispatch — the compiler emits a direct pointer to Order.Submit()
```

### Dynamic dispatch (through an interface)

```go
var s Submittable = &o
s.Submit()  // dynamic dispatch — the pointer is found through the itab
```

The itab (interface table) is an internal Go runtime structure: a type-to-methods mapping. Each interface satisfaction is cached in an itab the first time it occurs.

### Method value — implicit closure

```go
fn := o.Submit  // this is a closure
```

`fn` holds a pointer (or a copy) of `o` inside it. If you pass `fn` to a global slice, it can **escape to heap**.

---

## Method Values, Closures, and Memory

### Method value escape

```go
type Service struct{ db *DB }
func (s *Service) Handle(req Req) Resp { ... }

func register(handlers map[string]func(Req) Resp) {
    s := &Service{db: openDB()}
    handlers["x"] = s.Handle  // s escapes to the heap
}
```

When `s.Handle` creates a method value, Go implicitly stores the `s` pointer. The closure lives on the heap, and `s` (the `Service` struct) is moved to the heap as well.

### Compiler view

```bash
go build -gcflags='-m' main.go
# main.go:5: &Service{...} escapes to heap
# main.go:6: s.Handle escapes to heap
```

### Performance impact

- **Method value escape** = one GC allocation.
- **Method expression** (`Service.Handle`) does NOT escape — the receiver is passed at runtime.

### Method expression with receiver dispatch

```go
type Pipeline []func(*Service, Req) Resp

func (s *Service) Step1(r Req) Resp { ... }
func (s *Service) Step2(r Req) Resp { ... }

p := Pipeline{(*Service).Step1, (*Service).Step2}
// The receiver is passed as an argument each time
```

This pattern minimizes allocations.

---

## Method Expressions for Generic Dispatch

### Strategy via method expression

```go
type Order struct{ ... }
func (o *Order) ApplyTax(rate float64)    { ... }
func (o *Order) ApplyDiscount(p float64)  { ... }

type Strategy func(*Order, float64)

strategies := map[string]Strategy{
    "tax":      (*Order).ApplyTax,
    "discount": (*Order).ApplyDiscount,
}

strategies["tax"](&order, 0.07)
```

This is polymorphism without interfaces: no interface is needed, yet you have pluggable behavior.

---

## Encapsulation Strategy

### Field gating

```go
type Account struct {
    balance float64    // private
    mu      sync.Mutex
}

func (a *Account) Balance() float64 {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.balance
}

func (a *Account) Withdraw(amt float64) error {
    a.mu.Lock()
    defer a.mu.Unlock()
    if amt > a.balance { return ErrInsufficient }
    a.balance -= amt
    return nil
}
```

Here the `balance` field is invisible from the outside — the only way to interact is through `Balance()` and `Withdraw()`. Mutex synchronization happens inside the method — the caller doesn't know and cannot get it wrong.

### Functional core, imperative shell

Pure logic — function. The state-changing part — method:

```go
// Pure core
func computeTotal(items []Item, taxRate float64) float64 { ... }

// Stateful shell
func (o *Order) RecalculateTotal() {
    o.Total = computeTotal(o.Items, o.taxRate)
}
```

How testing looks:
- `computeTotal` — pure unit test
- `RecalculateTotal` — minimal integration test

---

## Composition Over Inheritance

There is no inheritance in Go. Instead, **embedding** is used:

```go
type Base struct{ ID string }
func (b Base) Identify() string { return b.ID }

type User struct {
    Base
    Email string
}

u := User{Base: Base{ID: "u1"}, Email: "a@b.c"}
fmt.Println(u.Identify()) // u1 — Base's method is "promoted" to User
```

### Promotion rules

- **Exported** methods of the embedded type are promoted to User.
- Method set: if `Base` is embedded by value, `User`'s method set contains `Base`'s value methods; if `*Base` is embedded — both value and pointer methods are included.
- Method overriding is possible: if `User` defines its own `Identify()`, `Base.Identify()` is shadowed.

### Embedding with interfaces

```go
type Reader interface { Read([]byte) (int, error) }

type LoggingReader struct{ Reader }  // embedding an interface

func (lr LoggingReader) Read(p []byte) (int, error) {
    n, err := lr.Reader.Read(p)
    log.Println("read", n)
    return n, err
}
```

This is the decorator pattern, Go style.

---

## Testing Strategies

### Pure function — no mock

```go
// Pure
func calculateTax(amount float64, rate float64) float64 {
    return amount * rate
}

// Test
func TestCalculateTax(t *testing.T) {
    if got := calculateTax(100, 0.07); got != 7 {
        t.Errorf("got %v, want 7", got)
    }
}
```

### Method with dependency — interface for mock

```go
type EmailSender interface {
    Send(to, body string) error
}

type Notifier struct{ sender EmailSender }
func (n *Notifier) Notify(to, msg string) error { ... }

// Test
type fakeSender struct{ sent []string }
func (f *fakeSender) Send(to, body string) error {
    f.sent = append(f.sent, to)
    return nil
}

func TestNotify(t *testing.T) {
    f := &fakeSender{}
    n := &Notifier{sender: f}
    n.Notify("a@b.c", "hi")
    if len(f.sent) != 1 { t.Fatal("expected 1 send") }
}
```

### Writing tests for a method — table-driven

```go
func TestOrderSubmit(t *testing.T) {
    cases := []struct {
        name    string
        items   []Item
        wantErr bool
    }{
        {"empty", nil, true},
        {"valid", []Item{{ID: "i1"}}, false},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            o := &Order{Items: c.items}
            err := o.Submit()
            if (err != nil) != c.wantErr {
                t.Errorf("got err=%v, wantErr=%v", err, c.wantErr)
            }
        })
    }
}
```

---

## Concurrency and Receiver Choice

### Mutex and pointer receiver

```go
type SafeCounter struct {
    mu sync.Mutex
    n  int
}

// MUST be a pointer — to prevent the mutex copy bug
func (c *SafeCounter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func (c *SafeCounter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

If a value receiver is used:
```go
func (c SafeCounter) Inc() { ... }  // BAD

var c SafeCounter
go c.Inc()  // a copy of c is taken — the mutex is copied → vet warning
```

`go vet` reports a "passes lock by value" warning. A pointer receiver prevents this bug.

### Atomic + value receiver

```go
type Counter struct{ n atomic.Int64 }

// Even with a value receiver this cannot work — the atomic gets copied
// Always: pick a pointer receiver
func (c *Counter) Inc() { c.n.Add(1) }
```

`atomic.Int64` carries a `noCopy` marker — `go vet` will detect copy-and-use.

---

## Generics + Methods

Method rules for generic types in Go 1.18+:

```go
type List[T any] struct{ items []T }

func (l *List[T]) Add(x T)         { l.items = append(l.items, x) }
func (l *List[T]) Get(i int) T     { return l.items[i] }
func (l *List[T]) Len() int        { return len(l.items) }
```

**Rules:**
- A method cannot add its own type parameter (only the receiver type's parameters)
- The method name must fully match the struct's parameter list

```go
// ERROR
// func (l *List[T]) Map[U any](f func(T) U) *List[U] { ... }

// Correct way — a generic function at package level
func Map[T, U any](l *List[T], f func(T) U) *List[U] { ... }
```

This restriction exists to keep Go's generics simple.

---

## Real-World Refactoring

### Example: scattered functions → cohesive type

**Before (procedural):**

```go
func validateUser(name, email string) error { ... }
func saveUser(name, email string) error { ... }
func sendWelcome(email string) error { ... }

func registerUser(name, email string) error {
    if err := validateUser(name, email); err != nil { return err }
    if err := saveUser(name, email); err != nil { return err }
    return sendWelcome(email)
}
```

**After (cohesive):**

```go
type User struct {
    Name, Email string
}

func (u User) Validate() error { ... }

type UserService struct {
    repo  Repo
    email EmailGW
}

func (s *UserService) Register(u User) error {
    if err := u.Validate(); err != nil { return err }
    if err := s.repo.Save(u); err != nil { return err }
    return s.email.SendWelcome(u.Email)
}
```

Benefits:
- `User`'s behavior lives on `User`
- `UserService`'s dependencies are visible (DI)
- Easy to mock for tests

### Example: God object → focused types

**Before:**

```go
type App struct{}

func (a *App) ParseRequest(r *http.Request) ...
func (a *App) ValidateAuth(token string) ...
func (a *App) ConnectDB() ...
func (a *App) RenderTemplate(name string) ...
```

**After:**

```go
type RequestParser struct{}
type Authenticator  struct{}
type DBConnector    struct{}
type TemplateEngine struct{}
```

Each type has one responsibility (SRP).

---

## Library Design Decisions

### Public API: function or method?

| Use case | Choice |
|----------|--------|
| Quick utility | function (`strings.Contains`) |
| Stateful object | method (`http.Client.Do`) |
| Builder | method-chain (`strings.Builder.Write*`) |
| Configuration | functional options (function) |
| Domain entity | method |

### Versioning and backward compatibility

Adding a public method is non-breaking. Removing a method is breaking. Changing the receiver type (value→pointer) is **breaking** (the method set changes).

### Minimal interface (the caller declares it)

```go
// Bad — the library exposes a large interface
type DB interface {
    Query(...) ...
    Exec(...) ...
    Begin() ...
    Close() ...
    Stats() ...
}

// Good — minimal interface defined on the caller side
type Querier interface { Query(...) ... }

func DoX(q Querier) error { ... }
```

The caller can pass `*sql.DB`, `*sql.Tx`, or a mock — anything whose method set fits Querier.

---

## Cheat Sheet

```
ARCHITECTURE LAYERS
────────────────────────────
Domain    → entity methods
Service   → struct + DI methods
Utility   → pure functions

DISPATCH
────────────────────────────
Direct call         → static (compile time)
Interface           → dynamic (itab)
Method value        → closure (heap)
Method expression   → receiver as arg (no escape)

PERFORMANCE
────────────────────────────
Method value (s.M) → s escapes to heap
Method expr  (T.M) → no escape
Inlining or speed of value/method are the same

CONCURRENCY
────────────────────────────
With mutex/atomic → always pointer receiver
go vet "passes lock by value" — catches the copy bug

GENERICS
────────────────────────────
type List[T] — methods can use T
A method CANNOT add its own type parameter
Generic transform → package-level function

PUBLIC API
────────────────────────────
Adding a pointer receiver       → non-breaking
Pointer→value, value→pointer    → BREAKING
Removing a method               → BREAKING
Adding a method                 → non-breaking
```

---

## Summary

Senior-level method/function decisions:

1. **Method** — domain entity, stateful service, interface satisfier.
2. **Function** — pure logic, utility, generic transform.
3. **Method value** — has escape consequences; be careful with callbacks.
4. **Method expression** — escape-free dispatch.
5. **Embedding** — composition instead of inheritance.
6. **Concurrency** — pointer receiver when there is a sync primitive.
7. **Generics** — methods can't add their own parameters; lift to a package function.
8. **Public API** — changing the receiver type is breaking; be careful.

The senior choice is built on minimal interfaces, pure methods, and clear encapsulation. At the professional level we then combine all of this with domain modeling, DDD, and large-team coding standards.
