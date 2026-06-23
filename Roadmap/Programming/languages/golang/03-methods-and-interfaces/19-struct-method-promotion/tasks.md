# Struct Method Promotion — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — Compose Logger into Service via embedding
Create a `Logger` with a `Log(msg string)` method, and a `Service` that embeds `Logger`. Calling `svc.Log("hi")` must work without writing a Log method on Service.

```go
type Logger struct{ prefix string }
func (l Logger) Log(msg string) { /* ... */ }

type Service struct {
    Logger // embedded
    name string
}

// svc := Service{Logger: Logger{prefix: "[svc]"}, name: "billing"}
// svc.Log("started")
```

### Task 2 — Use sync.Mutex via embedding
Build a `SafeCounter` that embeds `sync.Mutex`. The embedded `Lock` and `Unlock` methods must be callable directly on the counter.

```go
type SafeCounter struct {
    sync.Mutex
    n int
}

// c.Lock(); c.n++; c.Unlock()
```

### Task 3 — Promoted field access
Embed a `Point` (with `X`, `Y` fields) into `Pixel`. Show that both `pix.X` (promoted) and `pix.Point.X` (qualified) refer to the same field.

```go
type Point struct{ X, Y int }
type Pixel struct {
    Point
    Color string
}
```

### Task 4 — Method set of an embedded value
Define `type Greeter struct{}` with `func (Greeter) Hello() string`. Embed it in `Worker`. Call the promoted method.

### Task 5 — Embedding a named type vs anonymous struct
Show two ways: embed a named type (`Logger`) and embed an anonymous struct. Explain why only the named-type form promotes methods.

---

## Medium 🟡

### Task 6 — Resolve ambiguity from two embedded fields with same method
Embed both `FileLogger` and `ConsoleLogger` into `Service`; both expose `Log(string)`. Calling `svc.Log("x")` must produce a compile error. Fix it by qualifying the call.

```go
type FileLogger struct{}
func (FileLogger) Log(msg string)    { /* file */ }

type ConsoleLogger struct{}
func (ConsoleLogger) Log(msg string) { /* stdout */ }

type Service struct {
    FileLogger
    ConsoleLogger
}
```

### Task 7 — Promote via *T vs T embed
Compare `struct{ Inner }` and `struct{ *Inner }`. Demonstrate that the method set of the outer type differs depending on whether `Inner` has pointer-receiver methods.

```go
type Inner struct{ n int }
func (i *Inner) Inc() { i.n++ }

type ByValue   struct{ Inner }
type ByPointer struct{ *Inner }
```

### Task 8 — Intentional shadowing of an embedded method
`Animal` provides `Speak() string`. `Dog` embeds Animal but overrides `Speak()` with a more specific implementation. Show how to still call the inner Speak from inside Dog's Speak.

### Task 9 — Promotion depth: shallowest wins
Build a chain `A` → `B` → `C` (each embeds the next). All three have `Tag() string`. Confirm the outermost matching method wins, and show the rule for equal depths.

### Task 10 — Promoted method inside an interface
`Logger.Log(string)` is an interface. `Service` embeds a concrete `consoleLogger`. Show that `Service` satisfies the `Logger` interface via promotion alone.

### Task 11 — Embedding for tag inheritance? It is not
Show that struct tags on the inner type are NOT promoted when accessing fields through the outer type — i.e. tags belong to the field declaration, not the value.

---

## Hard 🔴

### Task 12 — Build a struct that satisfies io.ReadWriter via embedding
Create a `RWBuffer` that embeds both an `io.Reader` and an `io.Writer`. The result must satisfy `io.ReadWriter` without writing any extra methods.

```go
type RWBuffer struct {
    io.Reader
    io.Writer
}

// var _ io.ReadWriter = (*RWBuffer)(nil)
```

### Task 13 — Diamond-like configuration; show no diamond problem
`A` embeds `Base`; `B` embeds `Base`; `C` embeds both `A` and `B`. Show what happens when Base provides `Name() string` — clarify that Go does NOT have the C++ diamond problem because there is no merging: `C` simply has two distinct copies, and the call must be qualified.

### Task 14 — Embed a sealed interface variant
Define a "sealed" interface that requires a private marker method. Embed the sealed interface into a struct that also adds public methods, and prove that only types in the same package can satisfy it.

```go
package shape

type Shape interface {
    Area() float64
    isShape() // unexported marker
}
```

### Task 15 — Refactor: convert composition-via-field to embedding
Take a `UserService` that uses `db *sql.DB` as a named field with explicit forwarding methods (`Ping`, `Close`). Refactor to embed `*sql.DB` so `Ping` and `Close` are promoted automatically. Discuss the tradeoff.

### Task 16 — Promotion through a pointer to an interface field
Show why `struct{ *io.Reader }` is unusual: pointer to interface is rare. Demonstrate when to use the cleaner `struct{ io.Reader }` instead, and when an explicit pointer-to-interface might still appear.

### Task 17 — Method promotion with generics constraint
Build `Cache[K comparable, V any]` that embeds `sync.RWMutex`. Methods `Get`, `Set`, `Delete` use the promoted `RLock` / `Lock` / `Unlock`.

---

## Expert 🟣

### Task 18 — Generic embedding with type parameter
Build `Observed[T any]` that embeds a generic `EventBus[T]`. The outer type promotes `Publish` / `Subscribe` methods from the embedded generic.

```go
type EventBus[T any] struct{ /* ... */ }
func (b *EventBus[T]) Publish(e T)             { /* ... */ }
func (b *EventBus[T]) Subscribe(fn func(T))    { /* ... */ }

type Observed[T any] struct {
    *EventBus[T]
    name string
}
```

### Task 19 — Mixin layering: three independent capabilities
Build `Robot` that embeds `Walker`, `Talker`, and `Worker`. Each provides its own methods. Show how this composes behavior without inheritance, and how to override any single capability via shadowing.

### Task 20 — Embedding to implement Stringer transitively
`Money` embeds `decimal.Big` (which has `String()`). Show that `fmt.Println(m)` uses the promoted `String()`, then customize it by adding `String()` directly on Money.

---

## Solutions

### Solution 1

```go
type Logger struct{ prefix string }
func (l Logger) Log(msg string) { fmt.Println(l.prefix, msg) }

type Service struct {
    Logger
    name string
}

// svc := Service{Logger: Logger{prefix: "[svc]"}, name: "billing"}
// svc.Log("started") // promoted: behaves like svc.Logger.Log("started")
```

### Solution 2

```go
type SafeCounter struct {
    sync.Mutex
    n int
}

func (c *SafeCounter) Inc() {
    c.Lock(); defer c.Unlock() // both promoted from sync.Mutex
    c.n++
}
```

### Solution 3

```go
type Point struct{ X, Y int }
type Pixel struct{ Point; Color string }

pix := Pixel{Point: Point{X: 10, Y: 20}, Color: "red"}
fmt.Println(pix.X, pix.Point.X) // 10 10  — same memory
pix.X = 99
fmt.Println(pix.Point.X)        // 99    — confirms identity
```

### Solution 4

```go
type Greeter struct{}
func (Greeter) Hello() string { return "hello" }

type Worker struct{ Greeter; id int }

// w := Worker{id: 1}
// fmt.Println(w.Hello()) // "hello" — promoted from Greeter
```

### Solution 5

```go
// (a) Named-type embed — promotes methods.
type Logger struct{}
func (Logger) Log(msg string) {}

type Service struct{ Logger } // promotes Log

// (b) Anonymous struct embed — promotes fields only, never methods,
// because an anonymous struct literal cannot declare methods.
type Other struct {
    struct{ ID int; Name string }
}
// var s Service; s.Log("ok")  // works
// var o Other;   o.ID = 1     // works (field promoted)
```

### Solution 6

```go
type FileLogger    struct{}
func (FileLogger) Log(msg string)    { /* file */ }

type ConsoleLogger struct{}
func (ConsoleLogger) Log(msg string) { /* stdout */ }

type Service struct {
    FileLogger
    ConsoleLogger
}

svc := Service{}
// svc.Log("x") // compile error: ambiguous selector svc.Log
svc.FileLogger.Log("x")    // OK — qualified
svc.ConsoleLogger.Log("x") // OK — qualified
```

When two embedded fields at the same depth provide the same selector,
Go does not pick one — the selector is invalid and must be qualified.

### Solution 7

```go
type Inner struct{ n int }
func (i *Inner) Inc() { i.n++ }

type ByValue   struct{ Inner }
type ByPointer struct{ *Inner }

// *ByValue   has Inc (pointer-receiver methods of an embedded value
//                     are promoted only onto the pointer).
//  ByValue   does NOT have Inc.
// *ByPointer has Inc.
//  ByPointer has Inc too — the embedded *Inner is already a pointer.

var _ interface{ Inc() } = &ByValue{}                  // OK
// var _ interface{ Inc() } = ByValue{}                // FAIL
var _ interface{ Inc() } = ByPointer{Inner: &Inner{}}  // OK
```

### Solution 8

```go
type Animal struct{ name string }
func (a Animal) Speak() string { return a.name + ": ..." }

type Dog struct{ Animal }
func (d Dog) Speak() string {
    base := d.Animal.Speak() // qualified call reaches the inner method
    return base + " (woof!)"
}
// d := Dog{Animal: Animal{name: "Rex"}}
// d.Speak() == "Rex: ... (woof!)"
```

### Solution 9

```go
type C struct{}
func (C) Tag() string { return "C" }

type B struct{ C }
func (B) Tag() string { return "B" }

type A struct{ B }
func (A) Tag() string { return "A" }

var a A
fmt.Println(a.Tag())     // "A" — outermost wins
fmt.Println(a.B.Tag())   // "B"
fmt.Println(a.B.C.Tag()) // "C"
```

Delete `A.Tag` and `a.Tag()` resolves to `B.Tag` — the shallowest
remaining match. If two embedded types at the SAME depth both define
`Tag`, the call becomes ambiguous (see Solution 6).

### Solution 10

```go
type Logger interface{ Log(msg string) }

type consoleLogger struct{}
func (consoleLogger) Log(msg string) { fmt.Println(msg) }

type Service struct {
    consoleLogger // embedding promotes Log into Service's method set
    name string
}

var _ Logger = Service{} // satisfied via promotion alone
```

### Solution 11

```go
type Inner struct {
    Name string `json:"name"`
}
type Outer struct{ Inner }

// json.Marshal(Outer{...}) uses the promoted Name with its inner tag.
// But the tag belongs to the field declaration on Inner — not Outer.
// type Outer2 struct { Inner `json:"inner"` } adds a tag on the
// embedded field itself; tags on inner fields do not "merge" upward.
```

### Solution 12

```go
type RWBuffer struct {
    io.Reader
    io.Writer
}

var _ io.ReadWriter = (*RWBuffer)(nil) // satisfied by promotion

// rw := &RWBuffer{Reader: strings.NewReader("hi"), Writer: os.Stdout}
// io.Copy(rw, rw)
```

The two interface fields contribute `Read` and `Write` to the outer
method set. No forwarding code is required.

### Solution 13

```go
type Base struct{ name string }
func (b Base) Name() string { return b.name }

type A struct{ Base }
type B struct{ Base }
type C struct{ A; B }

c := C{
    A: A{Base: Base{name: "from-A"}},
    B: B{Base: Base{name: "from-B"}},
}

// c.Name()              // ambiguous — same depth via A.Base and B.Base
fmt.Println(c.A.Name())  // "from-A"
fmt.Println(c.B.Name())  // "from-B"
```

There is no diamond problem in Go because bases are not merged. `C`
contains two independent `Base` values, and the language refuses to
pick one — the programmer must qualify.

### Solution 14

```go
package shape

type Shape interface {
    Area() float64
    isShape() // unexported marker — only this package can implement it
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14159 * c.R * c.R }
func (Circle) isShape()        {}

// External packages cannot satisfy Shape because they cannot define
// isShape(). Embedding still works:
type Decorated struct {
    Shape          // promotes Area + isShape from the embedded value
    Label string
}
// var _ Shape = Decorated{Shape: Circle{R: 1}, Label: "x"}
```

### Solution 15

```go
// Before — explicit forwarding:
type UserServiceV1 struct{ db *sql.DB }
func (s *UserServiceV1) Ping() error  { return s.db.Ping() }
func (s *UserServiceV1) Close() error { return s.db.Close() }

// After — embedding:
type UserService struct{ *sql.DB } // Ping, Close auto-promoted
```

Tradeoff: embedding leaks the entire `*sql.DB` API onto `UserService`
(Exec, Query, Stats...). Use embedding when the outer type is meant to
behave AS-A db handle; use a named field plus explicit forwarding when
you want strict control over the public surface.

### Solution 16

```go
// Idiomatic — embed the interface VALUE, not a pointer to it:
type Wrap struct{ io.Reader }

// Unusual — pointer to interface:
type WrapPtr struct{ R *io.Reader }
```

You almost never want `*io.Reader` because (1) an interface value
already contains a pointer (itab + data), and (2) pointer-to-interface
defeats the cheap copy semantics of interface values. The rare
legitimate case is swapping the interface value behind a shared pointer
at runtime (test injection into a singleton) or reflection code that
must take the address of an interface.

### Solution 17

```go
type Cache[K comparable, V any] struct {
    sync.RWMutex
    m map[K]V
}

func NewCache[K comparable, V any]() *Cache[K, V] {
    return &Cache[K, V]{m: make(map[K]V)}
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    c.RLock(); defer c.RUnlock() // promoted from sync.RWMutex
    v, ok := c.m[k]
    return v, ok
}
func (c *Cache[K, V]) Set(k K, v V) {
    c.Lock(); defer c.Unlock()
    c.m[k] = v
}
func (c *Cache[K, V]) Delete(k K) {
    c.Lock(); defer c.Unlock()
    delete(c.m, k)
}
```

### Solution 18

```go
type EventBus[T any] struct{ subs []func(T) }

func (b *EventBus[T]) Publish(e T) {
    for _, fn := range b.subs { fn(e) }
}
func (b *EventBus[T]) Subscribe(fn func(T)) {
    b.subs = append(b.subs, fn)
}

type Observed[T any] struct {
    *EventBus[T] // generic embedding; methods are promoted
    name string
}

// o := Observed[int]{EventBus: &EventBus[int]{}, name: "ints"}
// o.Subscribe(func(x int) { fmt.Println(o.name, x) })
// o.Publish(42) // promoted: o.EventBus.Publish(42)
```

### Solution 19

```go
type Walker struct{}; func (Walker) Walk() string { return "walking" }
type Talker struct{}; func (Talker) Talk() string { return "hello"   }
type Worker struct{}; func (Worker) Work() string { return "working" }

type Robot struct {
    Walker
    Talker
    Worker
    id string
}

// r := Robot{id: "R-1"}
// fmt.Println(r.Walk(), r.Talk(), r.Work())

// Override one capability without losing the others:
type ChattyRobot struct{ Robot }
func (c ChattyRobot) Talk() string { return c.Robot.Talk() + "!" }
```

### Solution 20

```go
// Pseudocode — assume decimal.Big has String() string.
type Big struct{ /* ... */ }
func (Big) String() string { return "0.00" }

type Money struct {
    Big              // promotes String()
    Currency string
}

// fmt.Println(Money{Currency: "USD"}) // "0.00" — uses promoted Big.String()

// Customize by shadowing:
func (m Money) String() string { return m.Big.String() + " " + m.Currency }
// fmt.Println(Money{Currency: "USD"}) // "0.00 USD" — outer wins
```

---

## Key takeaways

- Embedding is composition, not inheritance — the outer type is not a subtype of the inner.
- Method promotion works for named embedded types and interface fields, never for anonymous struct literals.
- Pointer-receiver methods of an embedded value `T` are promoted only onto `*Outer`. Embedding `*T` promotes them onto both.
- Shallowest match wins; equal-depth conflicts must be qualified.
- Go has no diamond problem — embedded bases are not merged.
