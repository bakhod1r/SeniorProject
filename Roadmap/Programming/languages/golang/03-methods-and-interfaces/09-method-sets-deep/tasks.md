# Method Sets Deep — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — Recite the method sets
For the following code, write the method sets of `Box` and `*Box`.

```go
type Box struct{ size int }
func (b Box)  Volume() int { return b.size * b.size * b.size }
func (b *Box) Resize(n int) { b.size = n }
```

### Task 2 — Make a value satisfy an interface
The interface `type Greeter interface { Hello() string }` is given. The type `Person` currently exposes `Hello` only on `*Person`. Modify the type so a `Person` value satisfies `Greeter` directly.

```go
type Person struct{ Name string }
// existing: func (p *Person) Hello() string { return "hi " + p.Name }
```

### Task 3 — Compile-time interface check
Add a single line that fails to compile if `*Counter` ever stops satisfying `io.Stringer`.

```go
type Counter struct{ n int }
func (c *Counter) String() string { return strconv.Itoa(c.n) }
```

### Task 4 — Address the literal
Rewrite the call so it compiles without introducing a named variable.

```go
type Door struct{}
func (d *Door) Open() {}

// Door{}.Open()   // does not compile
```

### Task 5 — Map element fix
The following snippet does not compile. Provide the smallest fix that keeps the map type as is.

```go
type Score struct{ value int }
func (s *Score) Bump() { s.value++ }

m := map[string]Score{"a": {value: 1}}
// m["a"].Bump()
```

---

## Medium 🟡

### Task 6 — Embed and propagate
`Inner` exposes `V()` (value receiver) and `P()` (pointer receiver). For each of `OuterV { Inner }` and `OuterP { *Inner }`, list the method sets of the outer value type and the outer pointer type.

### Task 7 — Composite literal call site
Explain why `(&Box{size: 1}).Resize(2)` compiles but `Box{size: 1}.Resize(2)` does not, and produce both forms.

### Task 8 — Interface holds a value
The following snippet panics or fails to compile — pick which and explain. Then propose the fix.

```go
type Bumper interface{ Bump() }
type Counter struct{ n int }
func (c *Counter) Bump() { c.n++ }

var b Bumper = Counter{n: 0}
b.Bump()
```

### Task 9 — Slice vs map mutation parity
Write a tiny program where the same call is legal on a slice element but illegal on a map element, then refactor the map version to make it legal without changing the receiver.

### Task 10 — Loop variable across versions
Predict the output for Go 1.21 and Go 1.22:

```go
type W struct{ id int }
func (w *W) Run() { fmt.Println(w.id) }

ws := []W{{1}, {2}, {3}}
var fns []func()
for _, w := range ws {
    fns = append(fns, w.Run)
}
for _, f := range fns { f() }
```

### Task 11 — Cast to access pointer methods
Given a function that returns `Box` (value), write the smallest expression that calls `Resize` on the returned value. (Hint: you may need a helper variable.)

```go
func make() Box { return Box{} }
// make().Resize(1)  // does not compile
```

### Task 12 — Decorator via embedded interface
Write a `LoggingReader` that embeds `io.Reader` and overrides `Read`. Use embedding so all other future methods of the inner reader are automatically promoted.

---

## Hard 🔴

### Task 13 — Builder with composite-literal addressability
Write a builder where the chained call must work even when the user starts the chain with a fresh literal.

```go
// Required: Builder{}.Add("x").Add("y").Build()
```

### Task 14 — Generic container with mixed receivers
Implement `type Stack[T any] struct{ items []T }` with `Push`, `Pop`, and `Peek`. Justify the receiver choice for each method using method-set arguments.

### Task 15 — Plugin registry that rejects value types
Build a registry that, at compile time, only accepts pointer types whose method set includes `Run()`. Show the use of compile-time assertions in plugin packages.

### Task 16 — Map-of-counters with safe mutation
Build a `Bag` type that stores `map[string]Counter` (value type) and exposes `Inc(key string)`. Pointer-receiver `Inc` on `Counter` must be honoured — design the API to make this safe.

### Task 17 — Interface escape inspection
Write code where a stack-allocated value is forced to escape because it becomes the dynamic value of an interface that requires a pointer-receiver method. Verify with `go build -gcflags='-m'`.

### Task 18 — Embedded pointer with nil zero value
Write `Service { *Logger }`. Demonstrate that `Service{}.Log()` panics because the embedded pointer is nil, and rewrite the type so `Service{}` is usable out of the box.

---

## Expert 🟣

### Task 19 — Write a reflect-based MethodSet introspector
Given any value, return the names of all methods in `MethodSet(T)` and `MethodSet(*T)`. Show that the two sets differ as expected.

### Task 20 — Generic interface satisfaction helper
Provide a generic helper `Implements[I any, T any]() bool` that returns whether `*T` satisfies `I`. The helper must work without instantiating `T`.

### Task 21 — Migration script for pre-1.22 loop captures
Write a static-analysis sketch (pseudo-code or `go/ast` walk) that flags `range` loops where the loop variable's `.Method` is captured by a closure or goroutine. The check should help upgrade legacy code.

### Task 22 — Custom rendering of embedding's method-set effects
Build a small CLI that, given a Go file, prints for each defined struct `S`: which methods are local, which are promoted from embedded fields, and which are reachable only through `*S`.

---

## Solutions

### Solution 1

```
MethodSet(Box)  = {Volume}
MethodSet(*Box) = {Volume, Resize}
```

`Resize` has a pointer receiver, so it lives only in the pointer's method set.

### Solution 2

```go
type Person struct{ Name string }
func (p Person) Hello() string { return "hi " + p.Name }
```

Switching to a value receiver puts `Hello` in `Person`'s method set. Now `var g Greeter = Person{}` compiles.

### Solution 3

```go
var _ io.Stringer = (*Counter)(nil)
```

The blank-identifier declaration is checked at compile time. `(*Counter)(nil)` is a typed nil pointer with the correct method set.

### Solution 4

```go
(&Door{}).Open()
```

`&Composite{}` is a special form: the literal's address can be taken because the compiler allocates storage for it implicitly.

### Solution 5

```go
v := m["a"]
v.Bump()
m["a"] = v
```

The temporary variable is addressable, so `v.Bump()` works as `(&v).Bump()`. Writing back updates the map. Alternative: change the map type to `map[string]*Score`.

### Solution 6

```
OuterV value:    {V}
OuterV pointer:  {V, P}    // *OuterV is addressable to its embedded Inner field
OuterP value:    {V, P}    // *Inner already supplies the pointer
OuterP pointer:  {V, P}
```

Embedding by pointer "promotes" the entire pointer method set into the outer value's method set.

### Solution 7

`Box{size: 1}` is a composite literal used as the call target — it is not addressable, so the compiler cannot auto-take its address for `(*Box).Resize`. `&Box{size: 1}` uses the language's special rule allowing the address of a composite literal to be taken explicitly.

```go
(&Box{size: 1}).Resize(2)        // OK
b := Box{size: 1}; b.Resize(2)   // OK — b is addressable
```

### Solution 8

The snippet fails to compile: `var b Bumper = Counter{n: 0}` requires `Counter`'s method set to contain `Bump`, but `Bump` is on `*Counter`. The fix:

```go
var b Bumper = &Counter{n: 0}
b.Bump()
```

Storing a pointer means the dynamic type is `*Counter`, which has `Bump` in its method set.

### Solution 9

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

s := []T{{n: 1}}
s[0].Inc()         // legal — slice element is addressable

m := map[string]T{"k": {n: 1}}
// m["k"].Inc()    // illegal — map element not addressable

v := m["k"]; v.Inc(); m["k"] = v   // refactored
```

### Solution 10

Go 1.21: prints `3 3 3`. The single `w` variable is mutated each iteration; every method value captured the same `&w`. Go 1.22: prints `1 2 3`. Each iteration has its own `w`, so each method value binds to a distinct receiver.

### Solution 11

```go
b := make()
b.Resize(1)
```

There is no terser legal form: `make().Resize(1)` cannot work because the return value is not addressable. A helper variable is the idiomatic answer.

### Solution 12

```go
type LoggingReader struct {
    io.Reader
}

func (l LoggingReader) Read(p []byte) (int, error) {
    n, err := l.Reader.Read(p)
    log.Printf("read %d bytes: %v", n, err)
    return n, err
}
```

The embedded `io.Reader` interface contributes `Read` to `LoggingReader`'s method set. Re-declaring `Read` on the wrapper shadows it.

### Solution 13

```go
type Builder struct{ parts []string }

func (b *Builder) Add(s string) *Builder {
    b.parts = append(b.parts, s)
    return b
}
func (b *Builder) Build() string { return strings.Join(b.parts, " ") }

// Usage requires &Builder{}, since Builder{}.Add(...) cannot take an address:
result := (&Builder{}).Add("x").Add("y").Build()
```

The `&Builder{}` literal-address form is the special case that makes the chain work without an intermediate variable. The pointer receiver is essential because `Add` mutates `parts`.

### Solution 14

```go
type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(x T) { s.items = append(s.items, x) }   // mutates → pointer
func (s *Stack[T]) Pop() (T, bool) {                             // mutates → pointer
    var zero T
    if len(s.items) == 0 { return zero, false }
    x := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return x, true
}
func (s *Stack[T]) Peek() (T, bool) {                            // pointer for consistency
    var zero T
    if len(s.items) == 0 { return zero, false }
    return s.items[len(s.items)-1], true
}
```

All methods use pointer receivers so the stack's method set lives entirely on `*Stack[T]`. Callers store `*Stack[T]`, and embedding it in another struct does not split the method set across `T`/`*T`.

### Solution 15

```go
type Plugin interface{ Run() }

var registry []Plugin

func Register(p Plugin) { registry = append(registry, p) }

// In plugin package:
type MyPlugin struct{}
func (p *MyPlugin) Run() {}

var _ Plugin = (*MyPlugin)(nil)   // compile-time check

// Usage:
// Register(&MyPlugin{})
```

Because `Run` is pointer-receiver-only, only `*MyPlugin` satisfies `Plugin`. The `var _ Plugin = (*MyPlugin)(nil)` line guards against accidental refactors that drop the pointer.

### Solution 16

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

type Bag struct{ m map[string]Counter }

func NewBag() *Bag { return &Bag{m: map[string]Counter{}} }

func (b *Bag) Inc(key string) {
    c := b.m[key]   // copy out of the map
    c.Inc()         // c is addressable here
    b.m[key] = c    // copy back
}
```

The pattern uses a stack-local addressable copy to bridge the map-element non-addressability. Alternative: store `*Counter` in the map.

### Solution 17

```go
type Stringer interface{ String() string }
type X struct{ buf [256]byte }
func (x *X) String() string { return string(x.buf[:]) }

func produce() Stringer {
    var x X        // would live on the stack
    return &x      // escapes to heap because *X enters Stringer
}
```

`go build -gcflags='-m'` reports `&x escapes to heap`. The interface contract demands a stable pointer; escape analysis honours that.

### Solution 18

```go
type Service struct{ *Logger }   // bug: zero value has nil Logger

// Better:
type Service struct{ Logger Logger }   // value embedding, zero is usable

// Or initialize via a constructor:
func NewService() *Service { return &Service{Logger: Logger{}} }
```

By-pointer embedding gives a non-usable zero value. Switching to value embedding (or a constructor) keeps the methods reachable while preserving zero-value usability.

### Solution 19

```go
import "reflect"

func DumpSets(x any) {
    tv := reflect.TypeOf(x)        // value type
    tp := reflect.PointerTo(tv)    // pointer type

    fmt.Printf("MethodSet(%s):\n", tv)
    for i := 0; i < tv.NumMethod(); i++ { fmt.Println(" ", tv.Method(i).Name) }

    fmt.Printf("MethodSet(*%s):\n", tv)
    for i := 0; i < tp.NumMethod(); i++ { fmt.Println(" ", tp.Method(i).Name) }
}
```

`reflect.PointerTo` constructs the pointer type from a value type, exposing the pointer's method set.

### Solution 20

```go
import "reflect"

func Implements[I any, T any]() bool {
    iType := reflect.TypeOf((*I)(nil)).Elem()
    tType := reflect.TypeOf((*T)(nil)).Elem()
    return reflect.PointerTo(tType).Implements(iType)
}

// Usage:
ok := Implements[fmt.Stringer, MyType]()
```

Both reflect tricks (`(*I)(nil)`, `(*T)(nil)`) work without ever instantiating `I` or `T`. `PointerTo` switches to `*T`'s method set.

### Solution 21 (sketch)

```go
// Walk the AST, finding *ast.RangeStmt nodes.
// For each, capture the loop variable's *ast.Ident.
// Search the body for *ast.SelectorExpr or *ast.CallExpr where
// the X is the loop variable and the captured node lives inside
// a *ast.FuncLit, *ast.GoStmt, or *ast.DeferStmt.
// Emit a diagnostic with the file:line.
//
// Limitations: requires type info (go/types) to confirm the selector
// is a method, not a field; otherwise false positives.
```

The sketch is enough for a code review or a `go vet`-style linter contribution.

### Solution 22 (sketch)

```go
// Use go/parser + go/types to load a package.
// For each *types.Named struct type S:
//   ms_value := types.NewMethodSet(types.NewPointer(S).Elem())
//   ms_ptr   := types.NewMethodSet(types.NewPointer(S))
//   For each selection in ms_value/ms_ptr:
//     - Inspect Index() to detect promotion through an embedded field.
//     - Print "local" vs "promoted from <field>".
// Methods only in ms_ptr but not ms_value are flagged "*S only".
```

The `go/types` package exposes method sets directly, including promotion paths via the index slice.
