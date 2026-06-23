# Method Values and Method Expressions — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — Bind a method to a variable
Write a `Greeter` struct with a `Hi()` method. Create a method value `fn`
bound to a `Greeter` instance and call it.

```go
type Greeter struct{ name string }
func (g Greeter) Hi() string { return "Hi, " + g.name }

// Bind to fn and call.
```

### Task 2 — Method expression call
For the same `Greeter`, take the method expression `Greeter.Hi` and call it
with an explicit receiver.

### Task 3 — Type of method value
Given `func (t T) M(x int) int`, write down the types of `t.M`, `T.M`, and
`(*T).M`.

### Task 4 — Currying via method value
Define `Adder{base int}` with `Add(x int) int`. Make `addFive` by binding
`Adder{5}.Add`. Verify that `addFive(10) == 15`.

### Task 5 — Pointer receiver method value
Define `Counter{n int}` with `Inc()` (pointer receiver). Bind it to `inc`
and call `inc()` three times. Print `c.n`.

---

## Medium 🟡

### Task 6 — http.HandleFunc with method value
Build a `Server` struct with two HTTP handlers `Users` and `Orders`.
Register them with `http.HandleFunc` using method values.

### Task 7 — Dispatch table with method expressions
Define `Calc` with `Add`, `Sub`, `Mul`, `Div` methods. Build
`map[string]func(Calc, int, int) int` as a dispatch table. Implement
`Apply(op string, a, b int) int`.

### Task 8 — sort.Slice with bound method
Write a `People` slice of `Person{Name, Age}`. Provide method values
`lessByName` and `lessByAge` and use them with `sort.Slice`.

### Task 9 — Pre-Go 1.22 loop gotcha
Write code that demonstrates the receiver-capture issue when binding
method values inside a loop, then fix it for both Go 1.22+ and earlier.

### Task 10 — Convert method expression into bound function
Given `T.M`, write a helper that returns a closure equivalent to `t.M`:

```go
// Bind(T.M, t) -> func(args) results
```

### Task 11 — Detect heap escape
Write a small program that creates a method value, store it in a slice, and
verify with `go build -gcflags='-m'` that the receiver escapes.

### Task 12 — `(*T).M` indirection
For a value-receiver method `func (t T) M() int`, demonstrate that calling
`(*T).M(&t)` does **not** mutate `t` even when M is later modified to write
to a copy of the receiver.

---

## Hard 🔴

### Task 13 — Plugin registry
Build a `Plugin` type with methods `Hello`, `Status`, `Reload`. Build a
registry `map[string]func(Plugin)`. Add a function `Invoke(p Plugin, op
string)` that dispatches via method expression.

### Task 14 — Multi-receiver dispatch
Define types `English`, `French` each with method `Greet() string`. Build a
single dispatch map keyed by language code that returns the appropriate
greeting using method expressions:

```go
greet["en"](English{})
greet["fr"](French{})
```

(Hint: each entry in the map can have a different signature only if you
design carefully — you may need to wrap.)

### Task 15 — sort.Slice with multi-key comparison
Sort a slice of `Person` by `Age` ascending, then by `Name` ascending. Use
method values for the comparator chain.

### Task 16 — Method value benchmark
Write a benchmark that compares calling a method directly vs through a
method value 1,000,000 times. Run with `go test -bench=. -benchmem` and
record allocation differences.

### Task 17 — Goroutine-safe method-value broadcast
Build an `EventBus` where you can register handler method values via
`Bus.Subscribe(handler.OnEvent)`. The bus calls all subscribers
concurrently when an event fires.

### Task 18 — Interface method value
Take an `io.Writer` interface value, bind its `Write` method, and call it
through the bound function. Verify that re-assigning the original interface
variable does not affect the bound method.

---

## Expert 🟣

### Task 19 — Reflection: method value via reflect
Given an arbitrary value `v`, look up its method named `"Run"` using
`reflect.Value.Method` and invoke it. Compare with `reflect.Type.Method`
which exposes the method expression form.

### Task 20 — Generic dispatch table
Build a generic `Dispatcher[T any]` that holds a map of method expressions
of type `func(T, ...any) any`. Demonstrate it with two different generic
types.

### Task 21 — State machine via method expression table
Implement a state machine where each state is a method expression. The
machine holds a current method value and `Step(input)` calls it, replacing
itself based on the result.

### Task 22 — Avoid the heap-escape trap
Refactor an http.Server registration that is allocating per request because
of repeated method-value bindings. Compare allocations with `-benchmem`.

---

## Solutions

### Solution 1

```go
type Greeter struct{ name string }
func (g Greeter) Hi() string { return "Hi, " + g.name }

g := Greeter{name: "Ada"}
fn := g.Hi
fmt.Println(fn())  // Hi, Ada
```

### Solution 2

```go
expr := Greeter.Hi
fmt.Println(expr(Greeter{name: "Ada"}))  // Hi, Ada
// Type of expr: func(Greeter) string
```

### Solution 3

```
t.M     -> func(int) int
T.M     -> func(T, int) int
(*T).M  -> func(*T, int) int
```

### Solution 4

```go
type Adder struct{ base int }
func (a Adder) Add(x int) int { return a.base + x }

addFive := Adder{base: 5}.Add
fmt.Println(addFive(10))  // 15
```

### Solution 5

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

c := &Counter{}
inc := c.Inc        // captures &(*c)
inc(); inc(); inc()
fmt.Println(c.n)    // 3
```

### Solution 6

```go
type Server struct{ db *sql.DB }
func (s *Server) Users(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "users")
}
func (s *Server) Orders(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "orders")
}

s := &Server{db: db}
mux := http.NewServeMux()
mux.HandleFunc("/users",  s.Users)
mux.HandleFunc("/orders", s.Orders)
```

### Solution 7

```go
type Calc struct{}
func (Calc) Add(a, b int) int { return a + b }
func (Calc) Sub(a, b int) int { return a - b }
func (Calc) Mul(a, b int) int { return a * b }
func (Calc) Div(a, b int) int { return a / b }

var ops = map[string]func(Calc, int, int) int{
    "+": Calc.Add,
    "-": Calc.Sub,
    "*": Calc.Mul,
    "/": Calc.Div,
}

func Apply(op string, a, b int) int {
    return ops[op](Calc{}, a, b)
}
```

### Solution 8

```go
type Person struct {
    Name string
    Age  int
}
type People []Person

func (p People) lessByName(i, j int) bool { return p[i].Name < p[j].Name }
func (p People) lessByAge(i, j int) bool  { return p[i].Age  < p[j].Age  }

people := People{
    {"Ada", 30},
    {"Bob", 25},
    {"Carol", 28},
}

sort.Slice(people, people.lessByAge)   // by age
sort.Slice(people, people.lessByName)  // by name
```

### Solution 9

```go
// Pre-Go 1.22 BUG:
services := []*Service{{name: "a"}, {name: "b"}, {name: "c"}}
var fns []func()
for _, s := range services {
    fns = append(fns, s.Run)   // OK in 1.22+, but in 1.21 captures shared s
}

// Pre-1.22 fix:
for _, s := range services {
    s := s                      // shadow
    fns = append(fns, s.Run)
}

// Go 1.22+ — no fix needed: s is per-iteration.
```

### Solution 10

```go
func Bind[T, A1, R any](m func(T, A1) R, t T) func(A1) R {
    return func(a A1) R { return m(t, a) }
}

// Usage:
addFive := Bind(Adder.Add, Adder{base: 5})
fmt.Println(addFive(10))
```

### Solution 11

```go
type Big struct{ buf [1 << 16]byte }
func (b Big) Run() {}

func main() {
    b := Big{}
    var fns []func()
    fns = append(fns, b.Run)   // b escapes to heap
    fns[0]()
}

// $ go build -gcflags='-m' .
// ./main.go:7:6: moved to heap: b
// ./main.go:9:21: b.Run escapes to heap
```

### Solution 12

```go
type T struct{ n int }
func (t T) M() int { return t.n }

t := T{n: 1}
me := (*T).M           // type: func(*T) int
fmt.Println(me(&t))    // 1
fmt.Println(t.n)       // 1 — unchanged; copy was passed
```

### Solution 13

```go
type Plugin struct{ id string }
func (p Plugin) Hello()  { fmt.Println("hello from", p.id) }
func (p Plugin) Status() { fmt.Println("status of", p.id) }
func (p Plugin) Reload() { fmt.Println("reloading",   p.id) }

var registry = map[string]func(Plugin){
    "hello":  Plugin.Hello,
    "status": Plugin.Status,
    "reload": Plugin.Reload,
}

func Invoke(p Plugin, op string) {
    if fn, ok := registry[op]; ok {
        fn(p)
        return
    }
    fmt.Println("unknown op:", op)
}
```

### Solution 14

```go
type English struct{}
func (English) Greet() string { return "Hello" }

type French struct{}
func (French) Greet() string { return "Bonjour" }

// Different receiver types -> wrap into a uniform signature:
var greet = map[string]func() string{
    "en": func() string { return English{}.Greet() },
    "fr": func() string { return French{}.Greet() },
}

fmt.Println(greet["en"]())
fmt.Println(greet["fr"]())

// Alternative: define an interface and use method expressions on the interface.
```

### Solution 15

```go
type Person struct {
    Name string
    Age  int
}
type People []Person

func (p People) lessByAge(i, j int) bool  { return p[i].Age  < p[j].Age  }
func (p People) lessByName(i, j int) bool { return p[i].Name < p[j].Name }

func multiSort(p People, less ...func(int, int) bool) {
    sort.SliceStable(p, func(i, j int) bool {
        for _, l := range less {
            if l(i, j) { return true }
            if l(j, i) { return false }
        }
        return false
    })
}

people := People{...}
multiSort(people, people.lessByAge, people.lessByName)
```

### Solution 16

```go
type T struct{ n int }
func (t T) Inc() int { return t.n + 1 }

var sink int

func BenchmarkDirect(b *testing.B) {
    t := T{n: 1}
    for i := 0; i < b.N; i++ { sink = t.Inc() }
}

func BenchmarkMethodValue(b *testing.B) {
    t := T{n: 1}
    fn := t.Inc
    for i := 0; i < b.N; i++ { sink = fn() }
}

// $ go test -bench=. -benchmem
// BenchmarkDirect       1000000000  0.30 ns/op  0 B/op  0 allocs/op
// BenchmarkMethodValue  1000000000  0.30 ns/op  0 B/op  0 allocs/op
//
// (Within the loop the closure does not escape; binding outside the loop
// is the cheap path. Bind inside the loop and you'll see allocations.)
```

### Solution 17

```go
type EventBus struct {
    mu   sync.Mutex
    subs []func(Event)
}

func (b *EventBus) Subscribe(fn func(Event)) {
    b.mu.Lock(); defer b.mu.Unlock()
    b.subs = append(b.subs, fn)
}

func (b *EventBus) Publish(e Event) {
    b.mu.Lock()
    subs := append([]func(Event){}, b.subs...)
    b.mu.Unlock()
    var wg sync.WaitGroup
    for _, fn := range subs {
        wg.Add(1)
        go func(f func(Event)) { defer wg.Done(); f(e) }(fn)
    }
    wg.Wait()
}

// Usage:
type Listener struct{ id string }
func (l Listener) OnEvent(e Event) { fmt.Println(l.id, e) }

bus := &EventBus{}
bus.Subscribe(Listener{"a"}.OnEvent)
bus.Subscribe(Listener{"b"}.OnEvent)
bus.Publish(Event{...})
```

### Solution 18

```go
var w io.Writer = os.Stdout
write := w.Write          // captures (type, *os.File) interface value
w = nil                   // does not affect captured method value
write([]byte("hello\n"))  // OK; still writes to Stdout
```

### Solution 19

```go
type Service struct{ id string }
func (s Service) Run() { fmt.Println("run", s.id) }

s := Service{id: "x"}

// Method value via reflect
v := reflect.ValueOf(s)
mv := v.MethodByName("Run")
mv.Call(nil)  // prints: run x

// Method expression via reflect
t := reflect.TypeOf(s)
me, _ := t.MethodByName("Run")
me.Func.Call([]reflect.Value{v})   // pass receiver explicitly
```

### Solution 20

```go
type Dispatcher[T any] struct {
    ops map[string]func(T)
}

func NewDispatcher[T any]() *Dispatcher[T] {
    return &Dispatcher[T]{ops: make(map[string]func(T))}
}

func (d *Dispatcher[T]) Register(name string, fn func(T)) {
    d.ops[name] = fn
}

func (d *Dispatcher[T]) Invoke(t T, name string) {
    if fn, ok := d.ops[name]; ok { fn(t) }
}

// Usage 1
type A struct{}
func (A) Foo() { fmt.Println("foo") }

dA := NewDispatcher[A]()
dA.Register("foo", A.Foo)
dA.Invoke(A{}, "foo")

// Usage 2
type B struct{ id string }
func (b B) Bar() { fmt.Println("bar", b.id) }

dB := NewDispatcher[B]()
dB.Register("bar", B.Bar)
dB.Invoke(B{id: "1"}, "bar")
```

### Solution 21

```go
type Machine struct {
    state func(string) func(string) any
}

func startState(in string) func(string) any   { ... }
func runningState(in string) func(string) any { ... }

// Step holds current state and transitions
type SM struct {
    cur func(string) any
}

func (m *SM) Step(in string) {
    next := m.cur(in)
    // expecting next to be itself a method-value-like closure (state func)
    if fn, ok := next.(func(string) any); ok {
        m.cur = fn
    }
}

// Concrete pattern: bind methods of a State struct as method values and store
// them in a struct field representing the current state.
type State struct{}
func (s State) Idle(in string)    any { return State.Active }
func (s State) Active(in string)  any { return State.Closed }
func (s State) Closed(in string)  any { return State.Closed }
```

### Solution 22

```go
// BAD: per-request method-value binding (allocates each request).
func registerBad(mux *http.ServeMux, db *sql.DB) {
    mux.HandleFunc("/x", func(w http.ResponseWriter, r *http.Request) {
        s := &Server{db: db}    // allocates each request
        s.Handle(w, r)
    })
}

// GOOD: bind once.
func registerGood(mux *http.ServeMux, s *Server) {
    mux.HandleFunc("/x", s.Handle)  // single bound method value
}

// Benchmark with go test -benchmem to see allocations vanish in the
// "good" version.
```

---

## Cheat Sheet

```
METHOD VALUE
  t.M       func(args)        receiver bound (snapshot at binding time)

METHOD EXPRESSION
  T.M       func(T, args)     value-receiver method
  (*T).M    func(*T, args)    pointer-receiver method (or value, dereffed)

WHEN TO USE
  Method value      callbacks, http.Handler, sort.Slice, channel sends
  Method expression dispatch tables, plugin registries, generic adapters

PITFALLS
  - Map elements not addressable -> no method value with pointer receiver
  - Receiver captured at binding moment, not call moment
  - Pre-Go 1.22 loops share the loop variable -> shadow `s := s`
  - Method values allocate when escaping the closure scope
  - Function values not == comparable
```
