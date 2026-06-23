# Sealed Interfaces — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — A first sealed interface
Define a sealed `Shape` interface using an unexported marker method (`isShape()`). Implement two variants: `Circle{Radius float64}` and `Square{Side float64}`.

### Task 2 — Sealed Expr (Number, BinOp, Var)
Build a sealed `Expr` for a calculator AST with `Number{Value float64}`, `BinOp{Op rune; Left, Right Expr}`, `Var{Name string}`. The interface must be sealed via an unexported method so no outside package can add new expression kinds.

### Task 3 — Constructors for sealed Expr
Add helpers `Num(v float64) Expr`, `Bin(op rune, l, r Expr) Expr`, `V(name string) Expr` so callers never reach for the struct literals.

### Task 4 — Pretty printer with type switch
Write `Print(e Expr) string` that uses a type switch to render `Number{2} → "2"`, `Var{x} → "x"`, `BinOp{+, 1, 2} → "(1 + 2)"`.

### Task 5 — Sealed Direction enum-like type
Replace an `int` enum with a sealed `Direction` with `North`, `South`, `East`, `West` zero-sized struct variants. The compiler must reject any direction defined outside the package.

---

## Medium 🟡

### Task 6 — Eval method via type switch
Add `Eval(e Expr, env map[string]float64) (float64, error)` for the `Expr` from Task 2. Use a single type switch; return an error for an unknown variable.

### Task 7 — Payment events: Captured / Refunded / Failed
Define a sealed `PaymentEvent` with `Captured{ID string; Amount int}`, `Refunded{ID string; Amount int}`, `Failed{ID string; Reason string}`. Write `Apply(events []PaymentEvent) int` that folds events into a balance (Captured adds, Refunded subtracts, Failed is ignored).

### Task 8 — Variant routing
Given the sealed `PaymentEvent`, write `Describe(e PaymentEvent) string` with a type switch and a `default` branch that panics with `"unhandled payment event"`.

### Task 9 — Sealed Option[T] (Some/None)
Build a generic `Option[T]` with `Some[T]{Value T}` and `None[T]{}`. Provide `Get(o Option[T]) (T, bool)`.

### Task 10 — Visitor pattern via type switch
For the sealed `Expr`, write `Walk(e Expr, visit func(Expr))` for a depth-first pre-order traversal. Drive recursion via a type switch.

### Task 11 — Counting variant kinds
Given `[]Expr`, write `Counts(es []Expr) (numbers, binops, vars int)` that walks the slice and increments per-kind counters.

---

## Hard 🔴

### Task 12 — Sealed JSON value
Model JSON as a sealed `JSONValue` with six variants: `Null{}`, `Bool{V bool}`, `Number{V float64}`, `String{V string}`, `Array{Items []JSONValue}`, `Object{Fields map[string]JSONValue}`. Write `Stringify(v JSONValue) string` producing compact JSON in a single type switch.

### Task 13 — ADT for HTTP routes (Match returns enum)
Model an HTTP router as a sealed ADT with `Static{Path}`, `Param{Prefix, Name}`, `Wildcard{Prefix}`. Write `Match(r Route, path string) (kind RouteKind, rest string)` where `RouteKind` is an enum (`KindMiss`, `KindStatic`, `KindParam`, `KindWildcard`). Return the parameter value or wildcard tail in `rest`.

### Task 14 — Mini AST with sealed Node
Design a sealed `Node` for a tiny language: `Lit{V int}`, `Add{L, R Node}`, `Let{Name string; Value, Body Node}`, `Ref{Name string}`. Implement `Eval(n Node, env map[string]int) int` purely via a type switch. `Let` introduces a new lexical binding for `Body` only.

### Task 15 — Exhaustive switch via go-vet directive comment
Add an `//exhaustive:enforce` directive comment so the `exhaustive` linter (run via `go vet -vettool=$(which exhaustive)`) flags missing cases. Place the comment above a type switch over a sealed interface, and document why this matters when a new variant is added.

### Task 16 — Decoding JSON without leaking shapes
Extend `JSONValue` with `Parse(raw string) (JSONValue, error)`. It must reject unknown shapes and never return a non-sealed implementation. Only `null`, `bool`, `number`, `string`, `array`, `object` are accepted.

### Task 17 — Reducer over sealed events
Write a generic driver `Fold[S any](events []SealedEvent, init S, step func(S, SealedEvent) S) S` over a sealed `SealedEvent` interface. Then build `BalanceProjection` for the Task 7 payment events using `Fold`. The driver must be variant-agnostic, but only sealed events can be passed.

---

## Expert 🟣

### Task 18 — Migrate an open interface into sealed without breaking external users
You inherit a public `Shape` used across many repositories. Plan a backward-compatible migration to a sealed `Shape` so that existing third-party implementations keep compiling for one release cycle, new code goes through a sealed `ShapeV2`, and a bridge `Adapt(Shape) ShapeV2` exists for old implementations.

### Task 19 — Sealed Result[T] emulating Rust's Result
Implement a generic sealed `Result[T any]` with `Ok[T]{Value T}` and `Err[T]{Err error}`. Provide `Map`, `AndThen`, `Unwrap`. The variants must be sealed so no external package can introduce a third state.

### Task 20 — Plugin-safe sealed interface using type identity
Design a sealed `Capability` that lives in a public package yet remains sealed. Use the unexported-method trick combined with type-identity rules to forbid same-named methods in another package from satisfying the interface. Show a failing example.

### Task 21 — Pattern-match helper over sealed Expr
Implement `Match[R any](e Expr, m Cases[R]) R` where `Cases[R]` exposes one function per variant. Required fields (zero-valued = panic). Demonstrate that adding a new variant becomes compile-time pressure because every `Cases[R]` literal must be updated.

---

## Solutions

### Solution 1

```go
type Shape interface{ isShape() }

type Circle struct{ Radius float64 }
type Square struct{ Side float64 }

func (Circle) isShape() {}
func (Square) isShape() {}
```

### Solution 2

```go
type Expr interface{ isExpr() }

type Number struct{ Value float64 }
type BinOp  struct{ Op rune; Left, Right Expr }
type Var    struct{ Name string }

func (Number) isExpr() {}
func (BinOp)  isExpr() {}
func (Var)    isExpr() {}
```

### Solution 3

```go
func Num(v float64) Expr          { return Number{Value: v} }
func Bin(op rune, l, r Expr) Expr { return BinOp{Op: op, Left: l, Right: r} }
func V(name string) Expr          { return Var{Name: name} }
```

### Solution 4

```go
func Print(e Expr) string {
    switch x := e.(type) {
    case Number: return strconv.FormatFloat(x.Value, 'f', -1, 64)
    case Var:    return x.Name
    case BinOp:  return "(" + Print(x.Left) + " " + string(x.Op) + " " + Print(x.Right) + ")"
    }
    panic("unreachable: sealed Expr exhausted")
}
```

### Solution 5

```go
type Direction interface{ isDirection() }
type North struct{}; type South struct{}; type East struct{}; type West struct{}

func (North) isDirection() {}
func (South) isDirection() {}
func (East)  isDirection() {}
func (West)  isDirection() {}
```

### Solution 6

```go
func Eval(e Expr, env map[string]float64) (float64, error) {
    switch x := e.(type) {
    case Number: return x.Value, nil
    case Var:
        v, ok := env[x.Name]
        if !ok { return 0, fmt.Errorf("unknown variable %q", x.Name) }
        return v, nil
    case BinOp:
        l, err := Eval(x.Left, env);  if err != nil { return 0, err }
        r, err := Eval(x.Right, env); if err != nil { return 0, err }
        switch x.Op {
        case '+': return l + r, nil
        case '-': return l - r, nil
        case '*': return l * r, nil
        case '/': return l / r, nil
        }
        return 0, fmt.Errorf("unknown op %q", x.Op)
    }
    panic("unreachable: sealed Expr exhausted")
}
```

### Solution 7

```go
type PaymentEvent interface{ isPaymentEvent() }
type Captured struct{ ID string; Amount int }
type Refunded struct{ ID string; Amount int }
type Failed   struct{ ID string; Reason string }

func (Captured) isPaymentEvent() {}
func (Refunded) isPaymentEvent() {}
func (Failed)   isPaymentEvent() {}

func Apply(events []PaymentEvent) (bal int) {
    for _, e := range events {
        switch x := e.(type) {
        case Captured: bal += x.Amount
        case Refunded: bal -= x.Amount
        case Failed:   // ignored
        }
    }
    return
}
```

### Solution 8

```go
func Describe(e PaymentEvent) string {
    switch x := e.(type) {
    case Captured: return fmt.Sprintf("captured %d on %s", x.Amount, x.ID)
    case Refunded: return fmt.Sprintf("refunded %d on %s", x.Amount, x.ID)
    case Failed:   return fmt.Sprintf("failed %s: %s", x.ID, x.Reason)
    default:       panic("unhandled payment event")
    }
}
```

### Solution 9

```go
type Option[T any] interface{ isOption() }
type Some[T any] struct{ Value T }
type None[T any] struct{}

func (Some[T]) isOption() {}
func (None[T]) isOption() {}

func Get[T any](o Option[T]) (T, bool) {
    if s, ok := o.(Some[T]); ok { return s.Value, true }
    var zero T
    return zero, false
}
```

### Solution 10

```go
func Walk(e Expr, visit func(Expr)) {
    visit(e)
    switch x := e.(type) {
    case BinOp:
        Walk(x.Left, visit)
        Walk(x.Right, visit)
    case Number, Var: // leaves
    }
}
```

### Solution 11

```go
func Counts(es []Expr) (numbers, binops, vars int) {
    for _, e := range es {
        switch e.(type) {
        case Number: numbers++
        case BinOp:  binops++
        case Var:    vars++
        }
    }
    return
}
```


### Solution 12

```go
type JSONValue interface{ isJSON() }
type Null struct{}; type Bool struct{ V bool }; type Number struct{ V float64 }
type String struct{ V string }
type Array  struct{ Items []JSONValue }
type Object struct{ Fields map[string]JSONValue }

func (Null) isJSON()   {}
func (Bool) isJSON()   {}
func (Number) isJSON() {}
func (String) isJSON() {}
func (Array) isJSON()  {}
func (Object) isJSON() {}

func Stringify(v JSONValue) string {
    switch x := v.(type) {
    case Null:   return "null"
    case Bool:   if x.V { return "true" }; return "false"
    case Number: return strconv.FormatFloat(x.V, 'f', -1, 64)
    case String: b, _ := json.Marshal(x.V); return string(b)
    case Array:
        parts := make([]string, len(x.Items))
        for i, it := range x.Items { parts[i] = Stringify(it) }
        return "[" + strings.Join(parts, ",") + "]"
    case Object:
        keys := make([]string, 0, len(x.Fields))
        for k := range x.Fields { keys = append(keys, k) }
        sort.Strings(keys)
        parts := make([]string, len(keys))
        for i, k := range keys {
            kb, _ := json.Marshal(k)
            parts[i] = string(kb) + ":" + Stringify(x.Fields[k])
        }
        return "{" + strings.Join(parts, ",") + "}"
    }
    panic("unreachable: sealed JSONValue exhausted")
}
```

### Solution 13

```go
type Route interface{ isRoute() }
type Static   struct{ Path string }
type Param    struct{ Prefix, Name string }
type Wildcard struct{ Prefix string }

func (Static) isRoute()   {}
func (Param) isRoute()    {}
func (Wildcard) isRoute() {}

type RouteKind int
const ( KindMiss RouteKind = iota; KindStatic; KindParam; KindWildcard )

func Match(r Route, path string) (RouteKind, string) {
    switch x := r.(type) {
    case Static:
        if x.Path == path { return KindStatic, "" }
    case Param:
        if strings.HasPrefix(path, x.Prefix) { return KindParam, strings.TrimPrefix(path, x.Prefix) }
    case Wildcard:
        if strings.HasPrefix(path, x.Prefix) { return KindWildcard, strings.TrimPrefix(path, x.Prefix) }
    }
    return KindMiss, ""
}
```

### Solution 14

```go
type Node interface{ isNode() }
type Lit struct{ V int }
type Add struct{ L, R Node }
type Let struct{ Name string; Value, Body Node }
type Ref struct{ Name string }

func (Lit) isNode() {}
func (Add) isNode() {}
func (Let) isNode() {}
func (Ref) isNode() {}

func Eval(n Node, env map[string]int) int {
    switch x := n.(type) {
    case Lit: return x.V
    case Add: return Eval(x.L, env) + Eval(x.R, env)
    case Ref: return env[x.Name]
    case Let:
        next := make(map[string]int, len(env)+1)
        for k, val := range env { next[k] = val }
        next[x.Name] = Eval(x.Value, env)
        return Eval(x.Body, next)
    }
    panic("unreachable: sealed Node exhausted")
}
```

### Solution 15

```go
// Install: go install github.com/nishanths/exhaustive/cmd/exhaustive@latest
// Run:     go vet -vettool=$(which exhaustive) ./...
// The directive below enforces exhaustiveness even when a default branch
// exists. When a new sealed variant is added, every type switch missing
// it becomes a vet error — preventing silent fall-through.

//exhaustive:enforce
func describe(e Expr) string {
    switch e.(type) {
    case Number: return "number"
    case BinOp:  return "binop"
    case Var:    return "var"
    }
    panic("unreachable")
}
```

### Solution 16

```go
func Parse(raw string) (JSONValue, error) {
    var any interface{}
    dec := json.NewDecoder(strings.NewReader(raw))
    dec.UseNumber()
    if err := dec.Decode(&any); err != nil { return nil, err }
    return convert(any)
}

func convert(v interface{}) (JSONValue, error) {
    switch x := v.(type) {
    case nil:    return Null{}, nil
    case bool:   return Bool{V: x}, nil
    case string: return String{V: x}, nil
    case json.Number:
        f, err := x.Float64()
        if err != nil { return nil, err }
        return Number{V: f}, nil
    case []interface{}:
        items := make([]JSONValue, len(x))
        for i, it := range x {
            jv, err := convert(it); if err != nil { return nil, err }
            items[i] = jv
        }
        return Array{Items: items}, nil
    case map[string]interface{}:
        fields := make(map[string]JSONValue, len(x))
        for k, vv := range x {
            jv, err := convert(vv); if err != nil { return nil, err }
            fields[k] = jv
        }
        return Object{Fields: fields}, nil
    }
    return nil, fmt.Errorf("unsupported JSON shape %T", v)
}
```

### Solution 17

```go
type SealedEvent interface{ isEvent() }
func (Captured) isEvent() {}
func (Refunded) isEvent() {}
func (Failed)   isEvent() {}

func Fold[S any](events []SealedEvent, init S, step func(S, SealedEvent) S) S {
    s := init
    for _, e := range events { s = step(s, e) }
    return s
}

func BalanceProjection(events []SealedEvent) int {
    return Fold(events, 0, func(bal int, e SealedEvent) int {
        switch x := e.(type) {
        case Captured: return bal + x.Amount
        case Refunded: return bal - x.Amount
        }
        return bal // Failed ignored
    })
}
```

### Solution 18

```go
// Step 1 — keep legacy open Shape exported as-is.
type Shape interface{ Area() float64 }

// Step 2 — sealed ShapeV2 in the same package.
type ShapeV2 interface {
    Area() float64
    isShapeV2() // sealing marker
}

// Step 3 — first-party sealed implementations.
type Rect struct{ W, H float64 }
func (r Rect) Area() float64 { return r.W * r.H }
func (Rect) isShapeV2()      {}

// Step 4 — bridge old to new for one release cycle.
type adapter struct{ s Shape }
func (a adapter) Area() float64 { return a.s.Area() }
func (adapter) isShapeV2()      {}
func Adapt(s Shape) ShapeV2     { return adapter{s: s} }

// Step 5 — Deprecated: use ShapeV2 directly; remove Shape in next major.
```

### Solution 19

```go
type Result[T any] interface{ isResult() }
type Ok[T any]  struct{ Value T }
type Err[T any] struct{ Err error }

func (Ok[T])  isResult() {}
func (Err[T]) isResult() {}

func Map[T, U any](r Result[T], f func(T) U) Result[U] {
    switch x := r.(type) {
    case Ok[T]:  return Ok[U]{Value: f(x.Value)}
    case Err[T]: return Err[U]{Err: x.Err}
    }
    panic("unreachable")
}

func AndThen[T, U any](r Result[T], f func(T) Result[U]) Result[U] {
    switch x := r.(type) {
    case Ok[T]:  return f(x.Value)
    case Err[T]: return Err[U]{Err: x.Err}
    }
    panic("unreachable")
}

func Unwrap[T any](r Result[T]) T {
    if v, ok := r.(Ok[T]); ok { return v.Value }
    panic(r.(Err[T]).Err)
}
```

### Solution 20

```go
// package cap
type Capability interface {
    Name() string
    isCapability() // unexported — only types in package cap can implement it
}

type Read  struct{}
type Write struct{}

func (Read)  Name() string  { return "read" }
func (Read)  isCapability() {}
func (Write) Name() string  { return "write" }
func (Write) isCapability() {}

// In another package this fails to compile:
//   type Shadow struct{}
//   func (Shadow) Name() string  { return "x" }
//   func (Shadow) isCapability() {} // ERROR — distinct method identity
// An unexported method name from another package has a different
// fully-qualified identity, so type identity blocks foreign satisfaction.
```

### Solution 21

```go
type Cases[R any] struct {
    Number func(Number) R
    BinOp  func(BinOp) R
    Var    func(Var) R
}

func Match[R any](e Expr, m Cases[R]) R {
    if m.Number == nil || m.BinOp == nil || m.Var == nil {
        panic("Match: all cases must be provided")
    }
    switch x := e.(type) {
    case Number: return m.Number(x)
    case BinOp:  return m.BinOp(x)
    case Var:    return m.Var(x)
    }
    panic("unreachable: sealed Expr exhausted")
}
// Adding a variant (e.g. Call) forces every Cases[R] literal to grow a
// Call field — turning omissions into compile errors at each call site.
```
