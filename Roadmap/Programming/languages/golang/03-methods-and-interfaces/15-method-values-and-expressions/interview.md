# Method Values and Method Expressions — Interview Questions

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

### Q1: What is a method value?

**Answer:** A method value is the expression `t.M` written **without** call
parentheses. It produces a function value with the receiver `t` already
bound. The resulting function takes only the method's regular arguments.

```go
type Greeter struct{ name string }
func (g Greeter) Hi() string { return "hi " + g.name }

g := Greeter{name: "Ada"}
fn := g.Hi          // method value, type: func() string
fmt.Println(fn())   // hi Ada
```

### Q2: What is a method expression?

**Answer:** A method expression is the form `T.M` (or `(*T).M`). It produces
a plain function that takes the receiver as its **first argument**.

```go
fn := Greeter.Hi          // type: func(Greeter) string
fmt.Println(fn(Greeter{name: "Ada"}))
```

### Q3: What is the type of `T.M` for `func (t T) M(x int) int`?

**Answer:** `func(T, int) int`. The receiver becomes the first parameter.

### Q4: What is the type of `t.M` for `func (t T) M(x int) int`?

**Answer:** `func(int) int`. The receiver is bound and removed from the
signature.

### Q5: Can you use a method value in `http.HandleFunc`?

**Answer:** Yes. This is one of the most common use cases.

```go
type Server struct{ db *sql.DB }
func (s *Server) Users(w http.ResponseWriter, r *http.Request) { ... }

s := &Server{db: db}
http.HandleFunc("/users", s.Users)   // method value
```

The receiver `s` is captured in the closure.

### Q6: What does "currying" mean in the context of method values?

**Answer:** Currying is partial application — fixing some arguments of a
function. A method value curries the receiver: `obj.M` is `M` with the
receiver argument already supplied.

### Q7: Where is the receiver stored when you take a method value?

**Answer:** Inside the closure that the method value represents. For value
receivers, a copy of the receiver is stored. For pointer receivers, the
pointer is stored.

---

## Middle-Level Questions

### Q8: When is the receiver evaluated for a method value?

**Answer:** The Go spec says the receiver expression "is evaluated and
saved during the evaluation of the method value." So the receiver is
evaluated **once**, at the point you write `t.M`, not at the call site.

```go
i := 1
get := func() T { i++; return T{i} }().Get   // get bound to T{2}
get()  // uses captured T{2}, regardless of later changes to i
```

### Q9: What is the difference between method value capture for value vs pointer receivers?

**Answer:**

| Receiver | Captured | Mutation visible? |
|----------|----------|-------------------|
| Value `(t T)`   | Copy of receiver | No  |
| Pointer `(t *T)` | Pointer to receiver | Yes |

```go
type Box struct{ n int }

func (b Box)  V() int { return b.n }   // value receiver
func (b *Box) P() int { return b.n }   // pointer receiver

b := Box{n: 1}
v := b.V       // captures copy
p := b.P       // captures &b
b.n = 99
fmt.Println(v(), p())   // 1 99
```

### Q10: Why does `(*T).M` exist if `T.M` already does?

**Answer:** When `M` has a pointer receiver, only `(*T).M` is legal — `T.M`
does not exist because `M` is not in `T`'s method set, only in `*T`'s.

```go
type T struct{}
func (t *T) M() {}

g := (*T).M    // OK, type func(*T)
// h := T.M    // compile error
```

### Q11: Does taking a method value cause heap allocation?

**Answer:** Usually yes. The closure containing the captured receiver
typically escapes to the heap because it can be passed somewhere or stored.
Verify with `go build -gcflags='-m=2'`. Sometimes the compiler can prove
non-escape and stack-allocate, but it's the exception.

### Q12: Can you compare two method values with `==`?

**Answer:** No. Function values (including method values) are not
comparable except against `nil`. Comparing them produces a compile error.

```go
// fmt.Println(t1.M == t2.M)  // compile error
```

### Q13: What happens with method values inside a `for` loop in Go 1.22+?

**Answer:** Each iteration captures a **distinct** receiver because Go 1.22
introduced per-iteration loop variables. This fixed the long-standing
"all goroutines see the same receiver" gotcha.

```go
// Go 1.22+
for _, s := range services {
    go s.Run    // each goroutine captures its own s
}
```

In Go 1.21 and earlier, `s` was a shared variable across iterations and you
needed to shadow it: `s := s` before the goroutine.

### Q14: Show the difference between calling and binding a method.

```go
type T struct{ n int }
func (t T) N() int { return t.n }

t := T{n: 5}
a := t.N()       // a == 5         — method called now
b := t.N         // b is func() int — method value, not yet called
c := b()         // c == 5         — call the bound method
```

### Q15: How does a method expression help build dispatch tables?

**Answer:** Because a method expression has the receiver as an explicit
first parameter, you can store it in a map alongside other functions of the
same shape.

```go
type Calc struct{}
func (Calc) Add(a, b int) int { return a + b }
func (Calc) Sub(a, b int) int { return a - b }

var ops = map[string]func(Calc, int, int) int{
    "+": Calc.Add,
    "-": Calc.Sub,
}
```

---

## Senior-Level Questions

### Q16: Explain the closure cost of a method value.

**Answer:** A method value desugars to a small heap-allocated struct
containing (function pointer, receiver). When the closure escapes, this
struct goes to the heap, increasing GC pressure. In hot paths, prefer:
- Calling the method directly: `s.Handle(args)`
- Or using method expressions and passing the receiver alongside: avoids
  capturing it in a closure.

### Q17: When does the receiver escape to the heap?

**Answer:** When the closure escapes. Concretely:
- Stored in a slice/map
- Returned from a function
- Sent to a channel
- Passed to `go`
- Passed to a function whose parameter is `func(...)`

```go
func register(h map[string]http.HandlerFunc) {
    s := &Server{}
    h["/x"] = s.Handle    // s escapes
}
```

Use `go build -gcflags='-m'` to confirm.

### Q18: Why are method values useful for `sort.Slice`?

**Answer:** `sort.Slice` takes a `less func(i, j int) bool`. A method value
on the slice (or its container) provides exactly that signature with the
slice already captured:

```go
type ByAge []Person
func (a ByAge) Less(i, j int) bool { return a[i].Age < a[j].Age }

sort.Slice(people, ByAge(people).Less)
```

Or simpler — bind the closure inline:

```go
sort.Slice(people, func(i, j int) bool { return people[i].Age < people[j].Age })
```

The method-value form is cleaner when the comparator is reused.

### Q19: Compare Go method values to C++ member function pointers.

**Answer:**
- C++ `&Class::method` is **unbound** — it needs an instance to be called
  (`(obj.*ptr)(args)`). Equivalent to Go's method expression.
- C++ has no native bound member-function pointer; you need
  `std::bind(&Class::method, &obj)` or a lambda.
- Go method values combine both: `obj.M` is bound, `T.M` is unbound.

### Q20: Compare to Java method references.

**Answer:**
- Java `obj::method` ≈ Go method value `obj.M`.
- Java `Class::method` ≈ Go method expression `T.M`.
- Java method references must satisfy a functional interface; Go method
  values just produce a `func(...)` value with a structural type.

### Q21: How do method values work with interfaces?

**Answer:** If `i` has interface type `I`, then `i.M` is a method value
that captures the entire interface value (type word + data word). Calls go
through the itab dispatch. The captured receiver does **not** "freeze" the
dynamic type — it captures the interface value, but interface values are
immutable, so the result is the same.

```go
var w io.Writer = os.Stdout
fn := w.Write
w = nil          // does not affect fn — fn still wraps os.Stdout
fn([]byte("hi")) // OK
```

### Q22: Method values and generics — what changed in Go 1.18+?

**Answer:** Methods on generic types must repeat the type parameter list.
Method expressions require the type to be **instantiated**:

```go
type Box[T any] struct{ v T }
func (b Box[T]) Get() T { return b.v }

f := Box[int].Get          // OK — instantiated
// g := Box.Get             // ERROR — Box is uninstantiated
```

You cannot have a method expression that is itself generic; you must
instantiate first.

### Q23: How do `reflect.Value.Method` and `reflect.Type.Method` correspond to method values and method expressions?

**Answer:**
- `reflect.Value.Method(i)` returns a method **value** — the receiver is
  bound, calling `.Call` on it dispatches to the method.
- `reflect.Type.Method(i)` returns a `reflect.Method` describing the
  method, whose `Func` is the method **expression** (receiver is the first
  parameter).

```go
v := reflect.ValueOf(myObj)
m := v.Method(0)        // method value via reflect
m.Call([]reflect.Value{...})

t := reflect.TypeOf(myObj)
me := t.Method(0).Func  // method expression
me.Call([]reflect.Value{v, ...})  // pass receiver explicitly
```

### Q24: What is the impact of "receiver is captured by closure" on goroutine safety?

**Answer:** A method value captures the receiver at binding time. If the
receiver is mutable and is mutated concurrently, the captured snapshot
(value receivers) is safe but stale; the captured pointer (pointer
receivers) is shared and must be synchronized.

```go
func (s *State) Tick() { s.n++ }

s := &State{}
go s.Tick()
s.n++          // race! s is shared via pointer
```

Use mutexes or atomics for shared state.

### Q25: Can a method value cause a memory leak?

**Answer:** Yes, if the captured receiver references large memory (slices,
maps, big structs) and the method value is stored long-term. The closure
keeps the receiver alive even if the original variable goes out of scope.

```go
func handle() http.HandlerFunc {
    big := loadHugeData()    // 1GB
    return big.Serve         // method value keeps big alive forever
}
```

---

## Tricky / Curveball Questions

### Q26: What does this print?

```go
type T struct{ n int }
func (t T) Get() int { return t.n }

x := T{n: 1}
g := x.Get
x.n = 99
fmt.Println(g())
```

- a) 1
- b) 99
- c) Compile error
- d) Panic

**Answer: a — 1.** Value receiver: a copy of `x` (with `n=1`) is captured.
Subsequent mutation of `x.n` does not affect the copy.

### Q27: What does this print?

```go
type T struct{ n int }
func (t *T) Get() int { return t.n }

x := T{n: 1}
g := x.Get
x.n = 99
fmt.Println(g())
```

- a) 1
- b) 99
- c) Compile error
- d) Panic

**Answer: b — 99.** Pointer receiver: the address of `x` is captured. The
update `x.n = 99` is visible through that pointer.

### Q28: What does this print?

```go
type T struct{ n int }
func (t T) Get() int { return t.n }

m := map[string]T{"k": {n: 5}}
g := m["k"].Get
fmt.Println(g())
```

- a) 5
- b) 0
- c) Compile error
- d) Panic

**Answer: a — 5.** `m["k"]` returns a copy of the value; that copy is
captured by the value-receiver method value. Note this would be a compile
error if `Get` had a pointer receiver, since map elements are not
addressable.

### Q29: What does this print?

```go
type T struct{ n int }
func (t *T) Get() int { return t.n }

m := map[string]T{"k": {n: 5}}
g := m["k"].Get
fmt.Println(g())
```

- a) 5
- b) Compile error
- c) Panic

**Answer: b — Compile error.** Method value of a pointer-receiver method
requires an addressable receiver. `m["k"]` is not addressable.

### Q30: What does this print?

```go
type T struct{ n int }
func (t T) M(x int) int { return t.n + x }

f := T.M
fmt.Println(f(T{n: 10}, 5))
```

- a) 15
- b) 5
- c) Compile error

**Answer: a — 15.** `T.M` has type `func(T, int) int`; receiver is the
first explicit argument.

### Q31: What is the type of `(*T).M` if `M` has a value receiver?

```go
type T struct{ n int }
func (t T) M() int { return t.n }
```

- a) `func(T) int`
- b) `func(*T) int`
- c) Compile error

**Answer: b — `func(*T) int`.** Even though `M` was declared with a value
receiver, `(*T).M` is legal and dereferences the pointer for the call.

### Q32: What does this print in Go 1.22+ vs Go 1.21?

```go
type Service struct{ name string }
func (s Service) Run() { fmt.Println(s.name) }

services := []Service{{"a"}, {"b"}, {"c"}}
var fns []func()
for _, s := range services {
    fns = append(fns, s.Run)
}
for _, f := range fns { f() }
```

**Answer:**
- **Go 1.22+**: prints `a b c` — each iteration's `s` is a fresh variable,
  each method value captures its own copy.
- **Go 1.21 and earlier**: prints `c c c` — `s` is one shared variable,
  re-used each iteration; all method values capture the same final value.

### Q33: Trick — do method values allocate?

```go
type T struct{ n int }
func (t T) Inc() int { return t.n + 1 }

t := T{n: 1}
fn := t.Inc
fmt.Println(fn())
```

**Answer:** Yes, in most cases. The method value is a closure with the
captured receiver. `go build -gcflags='-m'` will say `t.Inc escapes to
heap`. If the closure does not escape past its scope, the compiler may
stack-allocate (rare).

---

## Coding Tasks

### Task 1: Build an event dispatcher with method expressions

```go
type Handler struct{ id string }
func (h Handler) OnLogin()  { fmt.Println("login:",  h.id) }
func (h Handler) OnLogout() { fmt.Println("logout:", h.id) }

// Build a registry: event name -> method expression
// Dispatch: invoke the registered method with a Handler
```

**Solution:**

```go
var registry = map[string]func(Handler){
    "login":  Handler.OnLogin,
    "logout": Handler.OnLogout,
}

func Dispatch(h Handler, event string) {
    if fn, ok := registry[event]; ok {
        fn(h)
    }
}
```

### Task 2: Convert a method value into a callback

```go
type Logger struct{ prefix string }
func (l Logger) Log(msg string) { fmt.Println(l.prefix, msg) }

// Pass the bound method to a function that expects func(string)
```

**Solution:**

```go
func process(messages []string, log func(string)) {
    for _, m := range messages { log(m) }
}

l := Logger{prefix: "[INFO]"}
process([]string{"a", "b"}, l.Log)
```

### Task 3: Sort by multiple comparators

```go
type Person struct {
    Name string
    Age  int
}

// Provide LessByName and LessByAge as method values
```

**Solution:**

```go
type People []Person

func (p People) LessByName(i, j int) bool { return p[i].Name < p[j].Name }
func (p People) LessByAge(i, j int) bool  { return p[i].Age  < p[j].Age  }

people := People{...}
sort.Slice(people, people.LessByAge)
sort.Slice(people, people.LessByName)
```

---

## System Design Style

### Q34: When would you choose method expressions over method values in a library API?

**Answer:** When the consumer needs to:
- Build dispatch tables keyed by string/enum.
- Plug in different receiver instances per call without rebinding.
- Avoid the closure allocation cost of bound method values.

When the consumer just wants to pass "the method bound to this object" as a
callback, prefer method values.

### Q35: How do you design an API for plugin-like extensibility using method expressions?

**Answer:** Define a `Plugin` type with a fixed set of methods. Maintain a
registry mapping operation names to method expressions of type
`func(Plugin, args) result`. The host calls into the registry by name,
passing the plugin instance.

```go
type Plugin struct{ name string }
func (p Plugin) Init()     {}
func (p Plugin) Shutdown() {}

var ops = map[string]func(Plugin){
    "init":     Plugin.Init,
    "shutdown": Plugin.Shutdown,
}
```

This approach is fully type-safe — the registry signature is statically
checked.

---

## What Interviewers Look For

### Junior

- Can write `t.M` vs `T.M` without confusion
- Understands a method value has the receiver bound
- Knows the type of `t.M` differs from `T.M`

### Middle

- Understands receiver capture timing (binding moment)
- Knows the value-vs-pointer receiver capture difference
- Knows method values usually escape to the heap
- Can use method values in `http.HandleFunc`, `sort.Slice`, etc.

### Senior

- Profiles method-value allocation cost in hot paths
- Understands the goroutine + method value gotcha (pre-Go 1.22)
- Knows the interaction with generics (instantiated types only)
- Can map Go method values/expressions onto C++ and Java equivalents
- Uses method expressions for dispatch tables and plugin systems

### Professional

- Designs APIs that judiciously expose method expressions for
  extensibility
- Uses `reflect.Value.Method` and `reflect.Type.Method` when building
  framework code
- Avoids long-lived method values that capture large receivers
- Knows when to refactor method values into explicit closures or vice
  versa

---

## Cheat Sheet

```
METHOD VALUE vs METHOD EXPRESSION
─────────────────────────────────────────
t.M    bound       func(args)          receiver captured
T.M    unbound     func(T, args)       value receiver
(*T).M unbound     func(*T, args)      pointer receiver

WHEN TO USE WHICH
─────────────────────────────────────────
Method value:       callback, http.Handler, sort.Slice less func
Method expression:  dispatch table, plugin registry, generic adapter

PERFORMANCE
─────────────────────────────────────────
Method value:       closure allocation (usually heap)
Method expression:  function pointer (no allocation)

GOTCHAS
─────────────────────────────────────────
- Receiver captured at binding moment
- Pointer receiver: pointer captured; mutations visible
- Value receiver: copy captured; mutations not visible
- Map elements not addressable -> no method value with pointer receiver
- Pre-Go 1.22 loop variable shared across iterations
- Method values are not == comparable (except vs nil)

REFLECTION
─────────────────────────────────────────
reflect.Value.Method(i)    -> method value
reflect.Type.Method(i).Func -> method expression
```
