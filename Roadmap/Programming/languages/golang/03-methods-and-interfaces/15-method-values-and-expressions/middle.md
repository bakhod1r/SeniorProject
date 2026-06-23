# Method Values and Method Expressions — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Two Forms in Detail](#the-two-forms-in-detail)
3. [Currying and Partial Application](#currying-and-partial-application)
4. [sort.Slice and Sort Helpers](#sortslice-and-sort-helpers)
5. [http.Handler Binding](#httphandler-binding)
6. [Event Handlers and Callback Registration](#event-handlers-and-callback-registration)
7. [Dispatch Tables](#dispatch-tables)
8. [Comparison: Closure vs Method Value vs Method Expression](#comparison-closure-vs-method-value-vs-method-expression)
9. [Cross-Language Comparison](#cross-language-comparison)
10. [Generic Methods and Method Values (Go 1.18+)](#generic-methods-and-method-values-go-118)
11. [Method Values with Embedding](#method-values-with-embedding)
12. [Common Patterns](#common-patterns)
13. [Anti-Patterns](#anti-patterns)
14. [Performance Sketch](#performance-sketch)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you saw the two forms: `t.M` (method value) and `T.M` / `(*T).M` (method expression). Now we use them in real situations:

- Wiring methods into the standard library (`sort`, `http`, `sync`).
- Currying — pre-supplying a receiver to make a smaller-arity function.
- Building dispatch tables driven by string keys.
- Plugging methods into goroutines safely.

Each scenario has a "right shape" — value or expression — and getting it wrong shows up later as either a subtle bug or wasted allocation.

---

## The Two Forms in Detail

```go
type Service struct{ id int }
func (s Service) Greet(name string) string {
    return fmt.Sprintf("[%d] hi %s", s.id, name)
}
func (s *Service) Tick() { s.id++ }
```

### Method value — the four shapes

```go
s := Service{id: 1}

// 1. Value-receiver method on a value
greet1 := s.Greet         // type: func(string) string

// 2. Value-receiver method on a pointer
ps := &s
greet2 := ps.Greet        // type: func(string) string  (auto-deref of ps)

// 3. Pointer-receiver method on a pointer
tick1 := ps.Tick          // type: func()

// 4. Pointer-receiver method on a value (must be addressable)
tick2 := s.Tick           // type: func()  — Go takes &s for you
```

### Method expression — the four shapes

```go
greetExpr1 := Service.Greet    // func(Service, string) string
greetExpr2 := (*Service).Greet // func(*Service, string) string  (also OK, *T's method set includes T's methods)

tickExpr1  := (*Service).Tick  // func(*Service)
// tickExpr2 := Service.Tick   // ERROR — Service value method set has no Tick
```

The key shift: a method expression takes the **receiver type literally**. If the method has a pointer receiver, you must use `(*T).M`. If it has a value receiver you may use either `T.M` or `(*T).M`.

---

## Currying and Partial Application

Currying turns a multi-argument function into a chain of single-argument functions. Method values are Go's closest built-in approximation: by binding the receiver, you "pre-supply" one argument.

```go
type Multiplier struct{ factor int }
func (m Multiplier) Apply(x int) int { return x * m.factor }

double := Multiplier{2}.Apply   // pre-bound, type: func(int) int
triple := Multiplier{3}.Apply

fmt.Println(double(5)) // 10
fmt.Println(triple(5)) // 15
```

This is currying via method values: each `MultiplierValue.Apply` pre-fills one slot.

### Currying further with closures

You can nest if you want repeated curry:

```go
type Op struct{ name string }
func (o Op) Pair(a int) func(int) int {
    return func(b int) int { return a + b }   // ignores name for brevity
}

addFive := Op{}.Pair(5)
fmt.Println(addFive(3)) // 8
```

---

## sort.Slice and Sort Helpers

`sort.Slice` takes a `less func(i, j int) bool`. A method value fits naturally:

```go
type People []Person

func (p People) lessByAge(i, j int) bool  { return p[i].Age  < p[j].Age }
func (p People) lessByName(i, j int) bool { return p[i].Name < p[j].Name }

func Sort(p People, by string) {
    var less func(i, j int) bool
    switch by {
    case "age":
        less = p.lessByAge        // method value — `p` captured
    case "name":
        less = p.lessByName
    }
    sort.Slice(p, less)
}
```

Without method values you'd need a closure: `func(i, j int) bool { return p[i].Age < p[j].Age }`. The method-value form is shorter and self-explanatory.

### sort.Interface — a different shape

`sort.Interface` is a *full* interface (`Len`, `Less`, `Swap`). Here you use the type itself, not method values. But internal "less by" choosing inside such a type is still a method-value pattern.

---

## http.Handler Binding

`http.HandleFunc` and routers love method values because handlers are usually methods of some service struct.

```go
type API struct {
    db  *sql.DB
    log *log.Logger
}

func (a *API) GetUser(w http.ResponseWriter, r *http.Request)    { /* ... */ }
func (a *API) ListUsers(w http.ResponseWriter, r *http.Request)  { /* ... */ }
func (a *API) CreateUser(w http.ResponseWriter, r *http.Request) { /* ... */ }

func main() {
    a := &API{db: openDB(), log: log.Default()}

    mux := http.NewServeMux()
    mux.HandleFunc("/users",     a.ListUsers)   // method values
    mux.HandleFunc("/user/get",  a.GetUser)
    mux.HandleFunc("/user/new",  a.CreateUser)

    http.ListenAndServe(":8080", mux)
}
```

Each `a.ListUsers` is a method value of type `func(http.ResponseWriter, *http.Request)` — exactly what `HandleFunc` wants. The `a` (with its db and logger) travels along with each handler via the closure.

### Why not method expressions here?

You *could* use them:

```go
mux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
    (*API).ListUsers(a, w, r)
})
```

But it's noisier and gains nothing — `HandleFunc` only sees the resulting function value either way. Method expressions shine when the receiver isn't fixed.

---

## Event Handlers and Callback Registration

A common pattern: an "Emitter" registers callbacks per event name, and listeners are methods of some object.

```go
type Emitter struct{ subs map[string][]func(any) }

func (e *Emitter) On(event string, cb func(any)) {
    e.subs[event] = append(e.subs[event], cb)
}

type Logger struct{ prefix string }
func (l *Logger) HandleAny(payload any) {
    log.Println(l.prefix, payload)
}

func main() {
    e := &Emitter{subs: map[string][]func(any){}}
    l := &Logger{prefix: "[evt]"}

    e.On("user.created", l.HandleAny)  // method value
    e.On("user.deleted", l.HandleAny)
    // l travels with each registration
}
```

This is exactly the JavaScript `addEventListener(handler)` pattern — but Go's method-value syntax does the binding in one token instead of `handler.bind(this)`.

---

## Dispatch Tables

Map a key to a method. Method expressions excel here because the receiver isn't fixed.

```go
type Order struct{ id string; total Money }

func (o *Order) ApplyTax(rate float64)      { /* ... */ }
func (o *Order) ApplyDiscount(p float64)    { /* ... */ }
func (o *Order) AddShipping(p float64)      { /* ... */ }

type fee = func(*Order, float64)

var fees = map[string]fee{
    "tax":      (*Order).ApplyTax,       // method expressions — no receiver yet
    "discount": (*Order).ApplyDiscount,
    "shipping": (*Order).AddShipping,
}

func Apply(o *Order, kind string, value float64) {
    if fn, ok := fees[kind]; ok {
        fn(o, value)
    }
}
```

Versus method values, where you'd need one map per Order — clearly wrong.

### Dispatch table for many objects

If you have many concrete objects and want each one's method, you'd put method values in a per-object map:

```go
handlers := map[string]http.HandlerFunc{
    "GET /users":    a.ListUsers,
    "POST /users":   a.CreateUser,
    "GET /users/:id": a.GetUser,
}
```

Mix and match: method values for **a specific instance**, method expressions for **the type's behavior**.

---

## Comparison: Closure vs Method Value vs Method Expression

```go
type T struct{ n int }
func (t *T) M(x int) int { return t.n + x }
t := &T{n: 10}
```

| Form | Code | Type | Allocates? |
|------|------|------|-----------|
| Closure | `func(x int) int { return t.M(x) }` | `func(int) int` | yes (closure on `t`) |
| Method value | `t.M` | `func(int) int` | yes (closure on `t`) |
| Method expression | `(*T).M` | `func(*T, int) int` | no (just a code pointer) |

The first two are equivalent in cost and semantics. The third is the cheapest — but the caller has to pass `t` explicitly.

---

## Cross-Language Comparison

| Language | Bound (= method value) | Unbound (= method expression) |
|----------|-----------------------|------------------------------|
| **Go**   | `t.M` | `T.M` / `(*T).M` |
| **Python** | `obj.m` (already bound) | `T.m` |
| **C++** | lambda capturing `this` | `&T::m` (pointer-to-member) |
| **Java** | `obj::m` (method reference) | `T::m` |
| **JavaScript** | `obj.m.bind(obj)` | not directly available |
| **C#** | `new Action(obj.M)` | delegate over `T` |

The Go syntax is unusually compact for both forms. The pointer-to-member form in C++ (`&T::m`) is the closest to Go's `(*T).M`, but C++ ones cannot be called without an `obj.*pmf` syntax — Go just calls them like ordinary functions.

---

## Generic Methods and Method Values (Go 1.18+)

```go
type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(x T)    { s.items = append(s.items, x) }
func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 { var z T; return z, false }
    n := len(s.items)
    x := s.items[n-1]
    s.items = s.items[:n-1]
    return x, true
}

s := &Stack[int]{}
push := s.Push           // type: func(int)
push(1); push(2); push(3)
```

A method value on a generic instantiation is fine — its type is concrete (`func(int)`) because `T` has been resolved at the moment of `s := &Stack[int]{}`.

### Method expression on a generic type

You must instantiate the type first:

```go
pushExpr := (*Stack[int]).Push   // func(*Stack[int], int)
s := &Stack[int]{}
pushExpr(s, 42)
```

You **cannot** write `(*Stack).Push` without instantiating — `Stack` alone is a type constructor, not a type.

### Restriction reminder

Methods can use the receiver's type parameters but cannot introduce their own. Therefore method values/expressions never need explicit type arguments at the call site — the receiver brings the binding with it.

---

## Method Values with Embedding

```go
type Base struct{ id string }
func (b Base) ID() string { return b.id }

type User struct{ Base; email string }
```

`User`'s method set includes `Base.ID` via promotion, so:

```go
u := User{Base: Base{id: "u1"}, email: "a@b.c"}

f1 := u.ID         // method value — type: func() string
f2 := User.ID      // method expression — type: func(User) string
f3 := Base.ID      // also valid — type: func(Base) string
```

`User.ID` works as a method expression because the promoted method *is* part of `User`'s method set. Go essentially synthesizes a wrapper that forwards `User.Base.ID()`.

---

## Common Patterns

### Pattern 1 — Lifecycle hooks
```go
type App struct{ /* ... */ }
func (a *App) Start() error { /* ... */ }
func (a *App) Stop()  error { /* ... */ }

type Hook struct{ Run func() error }

a := &App{}
hooks := []Hook{
    {Run: a.Start},
    {Run: a.Stop},
}
```

### Pattern 2 — Curry-style sort key

```go
type People []Person
func (p People) byField(name string) func(i, j int) bool {
    switch name {
    case "age":  return p.lessByAge
    case "name": return p.lessByName
    }
    return nil
}
```

### Pattern 3 — Strategy via method expression

```go
type Strategy func(*Order)

strategies := map[string]Strategy{
    "freeze":  (*Order).Freeze,
    "submit":  (*Order).Submit,
    "cancel":  (*Order).Cancel,
}

strategies["submit"](o)
```

### Pattern 4 — Pre-bound logger

```go
type Logger struct{ prefix string }
func (l *Logger) Info(s string) { fmt.Println(l.prefix, "INFO", s) }
func (l *Logger) Warn(s string) { fmt.Println(l.prefix, "WARN", s) }

l := &Logger{prefix: "[svc]"}
info := l.Info
warn := l.Warn
info("starting")
warn("low memory")
```

---

## Anti-Patterns

### Anti-pattern 1 — Method value in a tight loop

```go
// Bad — heap allocation each iteration
for i := 0; i < n; i++ {
    cb := obj.Process
    cb(i)
}

// Good
cb := obj.Process
for i := 0; i < n; i++ { cb(i) }

// Best — direct call
for i := 0; i < n; i++ { obj.Process(i) }
```

### Anti-pattern 2 — Capturing a value receiver expecting mutations

```go
type C struct{ n int }
func (c C) Inc() { c.n++ }   // value receiver — mutation lost

c := C{}
inc := c.Inc
inc(); inc(); inc()
fmt.Println(c.n) // 0
```

If mutation is required, use a pointer receiver and capture the pointer.

### Anti-pattern 3 — Method expression where method value is meant

```go
// Bad — receiver always reconstructed; loses identity
api := API{}
mux.HandleFunc("/x", func(w http.ResponseWriter, r *http.Request) {
    (*API).Handle(&api, w, r)
})

// Good
mux.HandleFunc("/x", api.Handle)
```

---

## Performance Sketch

| Form | Cost (one-time) | Cost (per call) |
|------|-----------------|-----------------|
| Direct `t.M(x)` | 0 | static dispatch (~1 ns) |
| Method value `f := t.M` | 1 closure alloc (heap if escapes) | indirect call (~1.5 ns) |
| Method expression `f := T.M` | 0 (just a code pointer) | indirect call + receiver pass |

Method values almost always cause the receiver to escape to the heap when assigned to a variable that outlives the local scope. The compiler's escape analysis output (`go build -gcflags='-m'`) makes this explicit.

A short rule: if you'd be calling `t.M(x)` in a loop, calling it directly is cheapest; if you'd otherwise be using a closure to wrap `t.M`, the method-value form is no worse and more idiomatic.

---

## Cheat Sheet

```
WHEN TO USE WHICH FORM
─────────────────────────────
Need a callback for THIS object         → method value     (t.M)
Need to dispatch over many receivers     → method expression (T.M / (*T).M)
Need to pass to sort.Slice / HandleFunc  → method value
Need to avoid closure allocation         → method expression
Method has POINTER receiver              → use (*T).M as expression
Generic method value                     → instantiate the type first

CAPTURE SEMANTICS
─────────────────────────────
value receiver     → COPY captured at creation
pointer receiver   → POINTER captured at creation
mutation-after     → only seen via pointer-receiver method value

INTEGRATION POINTS
─────────────────────────────
sort.Slice(p, p.lessByX)
http.HandleFunc(path, api.Handler)
go w.Run()
defer r.Close()
emitter.On("evt", l.Handle)

DISPATCH TABLES
─────────────────────────────
map[string]func(*T, ...): use method expressions
map[string]func(...):     use method values (per object)
```

---

## Summary

Method values and method expressions are two precise tools for converting a method into a function value:

- **Method value** (`t.M`) is the right tool when you have a *specific object* and you want to register or pass *its* behavior.
- **Method expression** (`T.M` or `(*T).M`) is the right tool when you want a *typed function-shaped reference* into the method, with the receiver supplied later.

The standard library uses both forms heavily — `http.HandleFunc`, `sort.Slice`, callback registries, and goroutine entry-points are mostly method values; small dispatch tables and strategy maps are mostly method expressions. The cost difference is small but real: method expressions don't allocate per creation, while method values do.

At the senior level we look at the runtime mechanics: closure layout, escape analysis, and how generics interact with these forms.
