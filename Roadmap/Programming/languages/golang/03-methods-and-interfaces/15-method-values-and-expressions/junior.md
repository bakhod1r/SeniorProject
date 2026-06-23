# Method Values and Method Expressions — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Error Handling](#error-handling)
13. [Common Mistakes](#common-mistakes)
14. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
15. [Test](#test)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction
> Focus: "What is it?" and "How to use it?"

In Go you usually call a method like this:

```go
t.Method(args)
```

But Go also lets you take the method itself and store it as a function value. There are **two distinct ways** of doing that, and they have different shapes.

```go
// 1) Method VALUE — the receiver is bound (captured)
fn := t.Method        // type: func(args)
fn(args)              // operates on t

// 2) Method EXPRESSION — the receiver is unbound (explicit first arg)
fn := T.Method        // type: func(T, args)
fn(t, args)           // pass receiver each time
```

A **method value** is what you get when you write a method's selector **without parentheses** on a *value*. A **method expression** is what you get when you write the same name on the *type* itself.

Both convert a method into a regular `func(...)` value — meaning you can pass it to other functions, store it in a slice or map, return it, or assign it to a variable. This is what makes callbacks, dispatch tables, and event handlers so natural in Go.

After reading this file you will:
- Recognize both forms at sight
- Know what type each form produces
- Know when the receiver is "captured"
- Be able to use these forms for callbacks and small dispatch tables

---

## Prerequisites
- You can write a basic Go method (`func (r T) M()`)
- You understand the difference between value receiver and pointer receiver
- You have used a function as a value at least once (`var f func(int) int = ...`)
- You have written `fmt.Println` and `go run main.go`

---

## Glossary

| Term | Definition |
|------|------------|
| **Method value** | The form `t.M` (no parens) — a function value with the receiver `t` bound inside |
| **Method expression** | The form `T.M` or `(*T).M` — a function value where the receiver is the explicit first parameter |
| **Selector** | The dotted form `x.f` used to look up a field or method |
| **Bound receiver** | A receiver that has been captured at the moment a method value is created |
| **Unbound receiver** | A receiver that must be supplied at each call (method expressions) |
| **Closure** | A function value that holds onto variables from the surrounding scope (a method value is a closure over its receiver) |
| **First-class function** | A value you can pass around like any other value |
| **Currying** | Pre-supplying some arguments to a function so the result takes fewer arguments |

---

## Core Concepts

### 1. Method value — `t.M`

Pick any value of a type that has a method, and write the selector **without parentheses**:

```go
type Greeter struct{ name string }

func (g Greeter) Hello() string {
    return "Hi, " + g.name
}

func main() {
    g := Greeter{name: "Alice"}

    hi := g.Hello   // method VALUE — no parentheses!
    // hi is now a value of type func() string
    // The receiver `g` is captured inside it.

    fmt.Println(hi())  // Hi, Alice
}
```

What just happened:
- `g.Hello` is **not** a call. It's a *value*.
- Its type is `func() string` — the same as the method's signature **minus the receiver**.
- The original `g` is stored inside `hi`.
- Calling `hi()` uses that stored `g`.

### 2. Method expression — `T.M`

Now use the **type name** instead of a value:

```go
hello := Greeter.Hello   // method EXPRESSION
// hello has type: func(Greeter) string
// The receiver becomes the first explicit argument.

g := Greeter{name: "Bob"}
fmt.Println(hello(g))    // Hi, Bob
```

What just happened:
- `Greeter.Hello` (with no parentheses) names the method *generically*, without any value.
- Its type has the receiver promoted to the first parameter.
- You must supply the receiver at every call.

### 3. Side-by-side comparison

| Form | Written as | Type | Receiver |
|------|------------|------|----------|
| Method value | `g.Hello` | `func() string` | bound to `g` |
| Method expression | `Greeter.Hello` | `func(Greeter) string` | passed at call |

### 4. Pointer-receiver method expression — `(*T).M`

If the method has a pointer receiver, the method expression must use `(*T).M`:

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

inc := (*Counter).Inc      // type: func(*Counter)
c := &Counter{}
inc(c)
inc(c)
fmt.Println(c.n) // 2
```

`Counter.Inc` (without the `*`) would NOT compile — the value `Counter` does not have `Inc` in its method set; only `*Counter` does.

### 5. The receiver is captured at the moment the method value is created

This is the single most important rule.

```go
type Box struct{ value int }
func (b Box) Show() { fmt.Println(b.value) }

b := Box{value: 1}
fn := b.Show       // captures b right now (value=1)

b.value = 999      // change the original
fn()               // prints: 1  — the captured copy is used
```

For a value receiver, a *copy* is captured. For a pointer receiver, the *pointer* is captured (and changes through the pointer ARE visible later).

---

## Real-World Analogies

**Analogy 1 — A pre-paid phone call vs a phone book entry**

A method value (`t.M`) is like a pre-paid phone call ticket: the destination is already filled in, you just press "call". A method expression (`T.M`) is like a phone-book entry: it says *which* function to use, but you still have to dial the number (provide the receiver) each time.

**Analogy 2 — Sticky note vs template**

`obj.Print` is a sticky note that says "print this specific obj". `Type.Print` is a template that says "to print, give me the obj first, then I will print it".

**Analogy 3 — A loaded gun vs a stack of ammunition**

A method value is loaded — the receiver is already inside. A method expression is the unloaded version — you must hand it the receiver each time.

---

## Mental Models

### Model 1 — Method = function with implicit first argument

This is the same model used in the Methods vs Functions section. Method expressions just **make that argument explicit**:

```go
// Method
func (g Greeter) Hello() string { ... }

// Method expression rewrites it as:
func Hello(g Greeter) string { ... }   // same machine code, just visible
```

A method value goes the other way: it pre-fills the implicit argument and hides it again.

### Model 2 — Two ways to slice the same pie

```
  func (g Greeter) Hello() string  ←  the method declaration
              │
   ┌──────────┴──────────┐
   │                     │
g.Hello              Greeter.Hello
type: func() string  type: func(Greeter) string
receiver: BOUND      receiver: UNBOUND
```

### Model 3 — Closure box

A method value is essentially a tiny struct: `{ receiver, code }`. When you call it, Go retrieves the receiver from the box and runs the code with it.

```
g.Hello   ──>  ┌──────────────────────┐
               │ receiver = (a copy   │
               │   of g)              │
               │ code = Greeter.Hello │
               └──────────────────────┘
```

---

## Pros & Cons

### Method value (`t.M`)

| Pros | Cons |
|------|------|
| Reads naturally — "this object's method" | Receiver may escape to the heap |
| Easy to register as a callback | The captured receiver is a snapshot |
| Works inside closures and goroutines | Allocates a closure on creation |
| Lets you build per-object event handlers | Stale-receiver bugs in loops |

### Method expression (`T.M`)

| Pros | Cons |
|------|------|
| No closure allocation on its own | Must supply receiver at call time |
| Fast dispatch tables | Reads less naturally |
| The receiver is fresh on every call | Not ideal for "this object" callbacks |
| Static once captured into a variable | Requires `(*T).M` for pointer receivers |

---

## Use Cases

### Method value
1. Register a per-object callback (`button.OnClick = handler.HandleClick`)
2. Pass a method to `go` for a goroutine (`go w.Run`)
3. Save a closure to call later (`defer file.Close`)
4. Bind a method to fit an interface that takes a `func(...)`

### Method expression
1. Build a small dispatch table keyed by string (`map[string]func(*Order, ...)`)
2. Pass a method as a sort or filter helper (`sort.Slice`)
3. Avoid creating a closure per iteration (no allocation)
4. Use a method "as a function" inside a generic helper

---

## Code Examples

### Example 1 — Saving a method value

```go
package main

import "fmt"

type Greeter struct{ name string }
func (g Greeter) Hello() string { return "Hi, " + g.name }

func main() {
    g := Greeter{name: "Alice"}
    hi := g.Hello       // method value
    fmt.Println(hi())   // Hi, Alice
}
```

### Example 2 — Same method, expression form

```go
package main

import "fmt"

type Greeter struct{ name string }
func (g Greeter) Hello() string { return "Hi, " + g.name }

func main() {
    hello := Greeter.Hello   // method expression
    fmt.Println(hello(Greeter{name: "Bob"}))  // Hi, Bob
}
```

### Example 3 — Pointer receiver: method expression needs `(*T).M`

```go
package main

import "fmt"

type Counter struct{ n int }
func (c *Counter) Inc()    { c.n++ }
func (c *Counter) Value() int { return c.n }

func main() {
    inc := (*Counter).Inc       // func(*Counter)
    val := (*Counter).Value     // func(*Counter) int

    c := &Counter{}
    inc(c)
    inc(c)
    inc(c)
    fmt.Println(val(c))         // 3
}
```

### Example 4 — The captured receiver is a snapshot (value receiver)

```go
package main

import "fmt"

type Box struct{ value int }
func (b Box) Show() { fmt.Println("value:", b.value) }

func main() {
    b := Box{value: 1}
    fn := b.Show

    b.value = 999
    fn()    // prints "value: 1"  — captured copy
    b.Show() // prints "value: 999"  — current value
}
```

### Example 5 — Pointer receiver: pointer is captured

```go
package main

import "fmt"

type Box struct{ value int }
func (b *Box) Show() { fmt.Println("value:", b.value) }

func main() {
    b := &Box{value: 1}
    fn := b.Show       // captures the pointer

    b.value = 999
    fn()               // prints "value: 999"  — same pointer
}
```

### Example 6 — Passing a method value to a `go` statement

```go
package main

import (
    "fmt"
    "sync"
)

type Worker struct{ id int }
func (w Worker) Run(wg *sync.WaitGroup) {
    defer wg.Done()
    fmt.Println("worker", w.id, "running")
}

func main() {
    var wg sync.WaitGroup
    workers := []Worker{{1}, {2}, {3}}
    for _, w := range workers {
        wg.Add(1)
        go w.Run(&wg)   // w.Run is a method value
    }
    wg.Wait()
}
```

### Example 7 — Method expression in a small dispatch table

```go
package main

import "fmt"

type Calculator struct{}
func (Calculator) Add(a, b int) int { return a + b }
func (Calculator) Sub(a, b int) int { return a - b }
func (Calculator) Mul(a, b int) int { return a * b }

func main() {
    ops := map[string]func(Calculator, int, int) int{
        "+": Calculator.Add,
        "-": Calculator.Sub,
        "*": Calculator.Mul,
    }

    var c Calculator
    fmt.Println(ops["+"](c, 2, 3)) // 5
    fmt.Println(ops["-"](c, 9, 4)) // 5
    fmt.Println(ops["*"](c, 6, 7)) // 42
}
```

### Example 8 — Method value as a `defer` target

```go
package main

import "fmt"

type Resource struct{ name string }
func (r *Resource) Close() { fmt.Println("closing", r.name) }

func use() {
    r := &Resource{name: "db"}
    defer r.Close()           // method value — receiver bound
    fmt.Println("using", r.name)
}

func main() {
    use()
    // using db
    // closing db
}
```

---

## Coding Patterns

### Pattern 1 — Bound callback

```go
type Button struct{ OnClick func() }
type App    struct{ count int }

func (a *App) Increment() { a.count++ }

func main() {
    a := &App{}
    b := &Button{OnClick: a.Increment}  // method value
    b.OnClick()
    b.OnClick()
    fmt.Println(a.count) // 2
}
```

### Pattern 2 — Tiny lookup table

```go
type Shape struct{ W, H float64 }
func (s Shape) Area()      float64 { return s.W * s.H }
func (s Shape) Perimeter() float64 { return 2 * (s.W + s.H) }

var calcs = map[string]func(Shape) float64{
    "area":      Shape.Area,
    "perimeter": Shape.Perimeter,
}
```

### Pattern 3 — Pre-bind once, call often

```go
type Logger struct{ prefix string }
func (l *Logger) Log(msg string) { fmt.Println(l.prefix, msg) }

l := &Logger{prefix: "[app]"}
log := l.Log              // bind once
for _, msg := range messages {
    log(msg)              // call many times
}
```

---

## Clean Code

### Rule 1 — Don't create method values inside hot loops

```go
// Bad — fresh closure each iteration
for _, x := range data {
    cb := obj.Process
    cb(x)
}

// Good — bind once
cb := obj.Process
for _, x := range data { cb(x) }

// Better still — direct call
for _, x := range data { obj.Process(x) }
```

### Rule 2 — Use method expressions when there is no obvious receiver

```go
// Good — dispatch table doesn't have one specific receiver
ops := map[string]func(*Order, int) error{
    "tax":      (*Order).ApplyTax,
    "discount": (*Order).ApplyDiscount,
}
```

### Rule 3 — Name variables holding method values like verbs

```go
// Good — reads naturally
notify := svc.Notify
notify("hello")

// Less good — looks like a noun
notification := svc.Notify
```

---

## Error Handling

A method value carries the same return signature as the original method, so error returns flow through normally:

```go
type Saver struct{ db *sql.DB }
func (s *Saver) Save(item Item) error { /* ... */ }

s := &Saver{db: db}
save := s.Save                // func(Item) error

if err := save(item); err != nil {
    log.Printf("save failed: %v", err)
}
```

A method expression behaves identically — the only difference is that you also pass the receiver:

```go
saveExpr := (*Saver).Save     // func(*Saver, Item) error
if err := saveExpr(s, item); err != nil { ... }
```

---

## Common Mistakes

| Mistake | Cause | Fix |
|---------|-------|-----|
| `Counter.Inc` won't compile | `Inc` has pointer receiver | Use `(*Counter).Inc` |
| Method value sees the wrong value | Captured a stale copy | Capture at the right moment, or use a pointer |
| Forgetting parentheses on call | `hi` not `hi()` | Add `()` |
| Calling `Type.Method` without receiver | Method expressions need it | `Type.Method(receiverValue, ...)` |
| Storing method values in a hot loop | Each iteration allocates a closure | Bind once, or call directly |

---

## Edge Cases & Pitfalls

### Pitfall 1 — Loop variable + method value (pre-Go 1.22)

```go
// Pre-Go 1.22: loop variable shared across iterations
for _, w := range workers {
    cb := w.Run    // SAME w each time
    callbacks = append(callbacks, cb)
}
```

In Go 1.22+ each iteration creates a fresh `w`, so this works as intended. Always check the Go version.

### Pitfall 2 — Map element + method value

```go
m := map[string]Greeter{"a": {name: "Alice"}}
fn := m["a"].Hello     // OK — m["a"] returns a copy, Hello captures the copy
```

Reading is fine, but **assigning back** later won't change `fn`'s captured copy:

```go
m["a"] = Greeter{name: "Bob"}
fmt.Println(fn())  // still "Hi, Alice"
```

### Pitfall 3 — Nil pointer captured

```go
type Logger struct{ prefix string }
func (l *Logger) Log(s string) { fmt.Println(l.prefix, s) }

var l *Logger // nil
log := l.Log
log("hi")    // panic — nil dereference inside Log
```

Capturing a nil pointer is fine; calling the method is what panics, and only if the method body dereferences the pointer.

---

## Test

### 1. What is the type of `g.Hello` if `func (g Greeter) Hello() string`?
- a) `Greeter`
- b) `func() string`
- c) `func(Greeter) string`
- d) `string`

**Answer: b**

### 2. What is the type of `Greeter.Hello`?
- a) `func() string`
- b) `func(Greeter) string`
- c) `Greeter`
- d) Compile error

**Answer: b**

### 3. Given `func (c *Counter) Inc()`, which compiles?
- a) `Counter.Inc`
- b) `(*Counter).Inc`
- c) Both
- d) Neither

**Answer: b**

### 4. What does this print?
```go
b := Box{value: 1}
fn := b.Show          // value receiver
b.value = 999
fn()
```
Where `Show` prints `b.value`.

- a) 1
- b) 999
- c) 0
- d) panic

**Answer: a**

### 5. A method value's receiver is captured...
- a) at the moment the method is called
- b) at the moment the method value is created
- c) lazily, on demand
- d) only for pointer receivers

**Answer: b**

---

## Cheat Sheet

```
METHOD VALUE
────────────────────────────────
syntax  : t.M           (no parens)
type    : func(args...)R   (receiver removed)
receiver: BOUND — captured at creation

METHOD EXPRESSION
────────────────────────────────
syntax  : T.M  or  (*T).M
type    : func(T, args...) R
          func(*T, args...) R
receiver: UNBOUND — passed at every call

CAPTURING RULE
────────────────────────────────
value receiver   → COPY of the value is captured
pointer receiver → POINTER is captured

FORMS
────────────────────────────────
Direct call    : t.M(x)
Method value   : f := t.M;    f(x)
Method expr    : f := T.M;    f(t, x)
Pointer expr   : f := (*T).M; f(&t, x)
```

---

## Summary

A **method value** (`t.M`) and a **method expression** (`T.M`) are two ways to take a method and turn it into a regular function value. The first one **binds** the receiver inside a closure; the second one keeps the receiver as an explicit first argument. Use the method-value form for callbacks tied to a specific object; use the method-expression form when you want a generic function-like reference into the type's behavior — small dispatch tables, sort helpers, or zero-allocation registration.

The most important thing to remember: **the receiver of a method value is captured *now*, not later**. If you need the latest value, either use a pointer receiver or rebuild the method value where you need it.
