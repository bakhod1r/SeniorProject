# Method Values and Method Expressions — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Method_values, §Method_expressions, §Selectors, §Calls, §Method_sets

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type Rules](#4-type-rules)
5. [Binding Semantics](#5-binding-semantics)
6. [Behavioral Specification](#6-behavioral-specification)
7. [Defined vs Undefined Behavior](#7-defined-vs-undefined-behavior)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Version History](#9-version-history)
10. [Implementation-Specific Behavior](#10-implementation-specific-behavior)
11. [Spec Compliance Checklist](#11-spec-compliance-checklist)
12. [Official Examples](#12-official-examples)
13. [Related Spec Sections](#13-related-spec-sections)

---

## 1. Spec Reference

### Method Values — Official Text (verbatim)

> If the method set of x's type contains m and the argument list can be
> assigned to the parameter list of m, x.m is called a method value. The
> method value x.m is a function value that is callable with the same
> arguments as a method call of x.m. The expression x is evaluated and saved
> during the evaluation of the method value; the saved copy is then used as
> the receiver in any calls, which may be executed later.

Source: https://go.dev/ref/spec#Method_values

> The type T may be an interface or non-interface type.
>
> As in the discussion of method expressions above, consider a struct type T
> with two methods, Mv, whose receiver is of type T, and Mp, whose receiver
> is of type *T.
>
> ```go
> type T struct {
>     a int
> }
> func (tv  T) Mv(a int) int         { return 0 }  // value receiver
> func (tp *T) Mp(f float32) float32 { return 1 }  // pointer receiver
>
> var t T
> ```
>
> The expression
>
> ```go
> t.Mv
> ```
>
> yields a function value of type
>
> ```go
> func(int) int
> ```
>
> These two invocations are equivalent:
>
> ```go
> t.Mv(7)
> f := t.Mv; f(7)
> ```
>
> Similarly, the expression
>
> ```go
> pt.Mp
> ```
>
> yields a function value of type
>
> ```go
> func(float32) float32
> ```

Source: https://go.dev/ref/spec#Method_values

### Method Expressions — Official Text (verbatim)

> If M is in the method set of type T, T.M is a function that is callable as
> a regular function with the same arguments as M prefixed by an additional
> argument that is the receiver of the method.
>
> ```go
> MethodExpr    = ReceiverType "." MethodName .
> ReceiverType  = Type .
> ```
>
> Consider a struct type T with two methods, Mv, whose receiver is of type T,
> and Mp, whose receiver is of type *T.
>
> ```go
> type T struct {
>     a int
> }
> func (tv  T) Mv(a int) int         { return 0 }  // value receiver
> func (tp *T) Mp(f float32) float32 { return 1 }  // pointer receiver
>
> var t T
> ```
>
> The expression
>
> ```go
> T.Mv
> ```
>
> yields a function equivalent to Mv but with an explicit receiver as its
> first argument; it has signature
>
> ```go
> func(tv T, a int) int
> ```
>
> That function may be called normally with an explicit receiver, so these
> five invocations are equivalent:
>
> ```go
> t.Mv(7)
> T.Mv(t, 7)
> (T).Mv(t, 7)
> f1 := T.Mv; f1(t, 7)
> f2 := (T).Mv; f2(t, 7)
> ```
>
> Similarly, the expression
>
> ```go
> (*T).Mp
> ```
>
> yields a function value representing Mp with signature
>
> ```go
> func(tp *T, f float32) float32
> ```
>
> For a method with a value receiver, one can derive a function with an
> explicit pointer receiver, so
>
> ```go
> (*T).Mv
> ```
>
> yields a function value representing Mv with signature
>
> ```go
> func(tv *T, a int) int
> ```
>
> Such a function indirects through the receiver to create a value to pass as
> the receiver to the underlying method; the method does not overwrite the
> value whose address is passed in the function call.

Source: https://go.dev/ref/spec#Method_expressions

---

## 2. Formal Grammar (EBNF)

### Method Value (within Selector)

A method value is a special form of a `Selector` expression that is not
followed by call parentheses:

```ebnf
Selector       = PrimaryExpr "." identifier .
MethodValue    = PrimaryExpr "." MethodName .
MethodName     = identifier .
```

### Method Expression

```ebnf
MethodExpr     = ReceiverType "." MethodName .
ReceiverType   = Type .
```

The `ReceiverType` may be parenthesized when needed to disambiguate pointer
receivers:

```ebnf
ReceiverType   = TypeName | "(" "*" TypeName ")" | "(" ReceiverType ")" .
```

### Composite Forms (informal)

```ebnf
PointerMethodExpression = "(" "*" TypeName ")" "." MethodName .
ValueMethodExpression   = TypeName "." MethodName .
BoundMethodValue        = Operand "." MethodName .
```

---

## 3. Core Rules & Constraints

### Rule 1 — Method Value Receiver Capture

The receiver expression is evaluated **once**, at the moment the method
value is created, and the resulting value is captured in the closure.

```go
type T struct{ n int }
func (t T) Get() int { return t.n }

x := T{n: 1}
f := x.Get      // evaluates x, captures copy
x.n = 99
fmt.Println(f()) // 1 — captured copy
```

### Rule 2 — Pointer Receiver Methods Capture the Pointer

For pointer-receiver methods, the captured value is the pointer (or address
of an addressable expression). Subsequent mutations through that pointer are
visible:

```go
type T struct{ n int }
func (t *T) Get() int { return t.n }

x := T{n: 1}
f := x.Get      // captures &x
x.n = 99
fmt.Println(f()) // 99
```

### Rule 3 — Method Expression Has No Bound Receiver

A method expression `T.M` produces a plain function value. The first
parameter is the explicit receiver:

```go
type T struct{}
func (t T) M(x int) int { return x }

f := T.M             // type: func(T, int) int
f(T{}, 7)            // 7
```

### Rule 4 — Pointer Method Expression Form `(*T).M`

A method declared with a pointer receiver must be written as `(*T).M` when
forming a method expression. The bare `T.M` is not legal for pointer-receiver
methods.

```go
type T struct{}
func (t *T) M() {}

g := (*T).M          // type: func(*T)
// h := T.M          // compile error: T.M does not exist (only *T.M does)
```

### Rule 5 — Value Method Expression `(*T).Mv`

Even for a value-receiver method `Mv`, the form `(*T).Mv` is legal and yields
a function whose first argument is `*T`. The receiver is dereferenced
automatically inside the call.

```go
type T struct{ a int }
func (t T) Mv(x int) int { return t.a + x }

f := (*T).Mv           // type: func(*T, int) int
t := T{a: 10}
fmt.Println(f(&t, 5))  // 15
```

The spec states the method does **not** overwrite the value whose address is
passed — a copy is made for the value receiver.

### Rule 6 — Method Set Determines Availability

Both method values and method expressions are governed by method sets:

| Receiver in declaration | `t.M` valid? | `T.M` valid? | `(*T).M` valid? |
|-------------------------|--------------|--------------|-----------------|
| `func (t T) M()`        | yes          | yes          | yes             |
| `func (t *T) M()`       | yes (if t addressable) | no | yes  |

### Rule 7 — Interface Method Values

If `i` has interface type `I` and `I` has method `M`, then `i.M` is a method
value that performs dynamic dispatch through the interface table.

```go
var w io.Writer = os.Stdout
fn := w.Write           // type: func([]byte) (int, error)
fn([]byte("hi"))        // dispatches via itab at call time
```

The receiver captured is the interface value (type, ptr) pair.

### Rule 8 — Argument List Assignability

The spec requires the argument list to be assignable to the parameter list
of `m`. Method values and method expressions inherit the same arity and type
checking that ordinary calls have.

---

## 4. Type Rules

### Method Value Signature

For receiver method `func (r R) M(p1 P1, ..., pN PN) (r1 R1, ...)`, the
method value `x.M` has type:

```
func(P1, ..., PN) (R1, ...)
```

The receiver is removed from the signature; arguments and results are
identical.

### Method Expression Signatures

For value receiver `func (r T) M(args) results`:

```
T.M       has type   func(T, args) results
(*T).M    has type   func(*T, args) results   // dereference indirection
```

For pointer receiver `func (r *T) M(args) results`:

```
(*T).M    has type   func(*T, args) results
T.M       does not exist as a method expression
```

### Type Identity Considerations

Two method values created from the same method but distinct receivers have
the same function type but are not necessarily comparable for equality. In
fact, method values (and all function values except `nil` comparisons) are
**not comparable** under `==` per the spec.

```go
var x, y T
fmt.Println(x.M == y.M) // compile error: func values not comparable
```

---

## 5. Binding Semantics

### When the Receiver Is Captured

The spec says: "The expression x is evaluated and saved during the
evaluation of the method value; the saved copy is then used as the receiver
in any calls, which may be executed later."

This produces an observable difference between:

```go
m1 := obj.M()    // immediate call: receiver evaluated, method runs
m2 := obj.M      // method value: receiver evaluated, method scheduled
m2()             // method runs now, with the saved receiver
```

### Closure Layout

A method value is implemented as a closure that captures:
1. The function pointer of the underlying method.
2. The receiver (value-typed) or the receiver pointer (pointer-typed
   methods).

For interface method values, the captured datum is the entire interface
two-word value (type word + data word).

### Currying / Partial Application

Method values are a form of partial application: the receiver is supplied
once and the resulting function takes the remaining arguments. Method
expressions are the **uncurried** form.

```go
type Adder struct{ base int }
func (a Adder) Add(x int) int { return a.base + x }

addFive := Adder{5}.Add   // bound — type func(int) int
fmt.Println(addFive(10))  // 15

raw := Adder.Add          // unbound — type func(Adder, int) int
fmt.Println(raw(Adder{5}, 10)) // 15
```

---

## 6. Behavioral Specification

### Rule — Receiver Snapshot for Value Receivers

For a value-receiver method, the receiver is **copied** at the moment the
method value is taken. The closure holds the copy. Mutations to the original
have no effect on the bound function.

```go
type Box struct{ v int }
func (b Box) V() int { return b.v }

b := Box{v: 1}
get := b.V
b.v = 100
fmt.Println(get())  // 1
```

### Rule — Pointer Capture for Pointer Receivers

For a pointer-receiver method `(t *T) M()`, the receiver expression must be
addressable (or already a pointer). The address is captured.

```go
type Box struct{ v int }
func (b *Box) V() int { return b.v }

b := Box{v: 1}
get := b.V       // captures &b
b.v = 100
fmt.Println(get())  // 100
```

If the receiver expression is **not addressable**, the method value is
illegal:

```go
m := map[string]Box{"k": {}}
// f := m["k"].V   // compile error: cannot take address of m["k"]
```

### Rule — Auto-Dereference / Auto-Address

When forming `t.M`:

- If `t` is `T` and `M` has receiver `*T`, the compiler implicitly takes
  `&t` (provided `t` is addressable).
- If `t` is `*T` and `M` has receiver `T`, the compiler implicitly
  dereferences `*t`.

These auto-conversions apply to method values just as they apply to method
calls.

### Rule — Method Expressions and Auto-Conversions

Method expressions do **not** apply auto-conversions to the receiver type.
The first parameter type is exactly what the spec dictates: `T` for `T.M`,
`*T` for `(*T).M`.

```go
type T struct{}
func (t *T) M() {}

var t T
m := (*T).M
m(&t)          // OK
// m(t)        // compile error: cannot use t (type T) as type *T
```

### Rule — Goroutines and Method Values

When a method value is passed to `go`, the receiver capture follows the
binding moment:

```go
for _, s := range services {
    go s.Run    // each iteration captures s (Go 1.22+ per-iteration variable)
}
```

In Go 1.21 and earlier, the loop variable was shared and method values
captured the same receiver across iterations — a classic bug. Go 1.22
changed loop semantics (per-iteration variable).

---

## 7. Defined vs Undefined Behavior

### Defined Operations

| Operation | Behavior |
|-----------|---------|
| `t.M` (method in t's method set) | method value, receiver captured |
| `T.M` (M has value receiver) | method expression, receiver explicit |
| `(*T).M` (M has either receiver) | method expression with pointer first arg |
| `i.M` for interface i | method value with itab dispatch |
| `((*T).M)(p, args)` | call form of pointer method expression |

### Illegal Operations

| Operation | Result |
|-----------|--------|
| `T.M` where M has pointer receiver | compile error |
| Method value of pointer method on non-addressable value | compile error |
| Comparing two method values via `==` | compile error |
| Method value on a method not in the type's method set | compile error |
| Taking method value of a private method from another package | compile error |

### Runtime Behavior

| Operation | Result |
|-----------|---------|
| Calling method value with nil interface receiver | runtime panic on dispatch |
| Calling pointer-method value where pointer is nil | depends on method body — panic if it dereferences |

### Undefined Behavior

The spec leaves no aspect of method values or method expressions undefined.
All cases either compile, are compile errors, or produce defined runtime
behavior (panic).

---

## 8. Edge Cases from Spec

### Edge Case 1 — Receiver Is a Function Call

```go
type T struct{ n int }
func (t T) Get() int { return t.n }

func make() T { return T{n: 42} }

g := make().Get      // make() is evaluated once here
fmt.Println(g())     // 42
fmt.Println(g())     // 42 — same captured value
```

### Edge Case 2 — Receiver Is an Interface

```go
type Stringer interface { String() string }

var s Stringer = time.Now()
f := s.String   // captures (type, data) pair
fmt.Println(f()) // current time as string
```

If `s` is later reassigned, the captured method value is unaffected.

### Edge Case 3 — Method Value of a Method on a Pointer

```go
type T struct{ n int }
func (t *T) M() {}

p := &T{}
f := p.M     // captures p
g := (*p).M  // also legal; auto-takes &(*p) — same address as p
```

### Edge Case 4 — Method Expression Across Types Sharing a Method

If `T1` and `T2` both have a method named `M`, the method expressions are
distinct function values:

```go
type A struct{}; func (A) M() {}
type B struct{}; func (B) M() {}

f := A.M    // type func(A)
g := B.M    // type func(B)
// f and g have incompatible signatures
```

### Edge Case 5 — Embedded Method via Method Expression

If `S` embeds `T`, then `S.M` (where `M` is promoted from `T`) is a method
expression with receiver `S`:

```go
type T struct{}
func (T) M() string { return "t" }

type S struct{ T }
f := S.M             // type: func(S) string — promoted
fmt.Println(f(S{}))  // "t"
```

### Edge Case 6 — Method Expression of a Generic Type

For Go 1.18+, methods on a generic type can be referenced via method
expressions only after the type is instantiated:

```go
type Box[T any] struct{ v T }
func (b Box[T]) Get() T { return b.v }

f := Box[int].Get      // type: func(Box[int]) int
fmt.Println(f(Box[int]{v: 7})) // 7
```

### Edge Case 7 — Method Set Restrictions for Interface Receivers

If `R` is an interface type, method expression `R.M` is legal — the result
takes an `R` argument and dispatches through the interface.

```go
type Reader interface { Read([]byte) (int, error) }

f := Reader.Read       // type: func(Reader, []byte) (int, error)
```

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Method values and method expressions defined in initial spec. |
| Go 1.1     | Refinements to selector expression rules; method value behavior solidified. |
| Go 1.4     | Additional examples added to the spec for clarity. |
| Go 1.18    | Generics introduced. Method expressions on generic types require an instantiated type. |
| Go 1.22    | Loop variable scoping changed to per-iteration. Method values created inside `for` loops now capture distinct receivers per iteration. |

---

## 10. Implementation-Specific Behavior

### Compiler Implementation (gc)

The Go gc compiler implements method values as closures. The closure
structure is roughly:

```
struct {
    fn  *func(receiver, args...) results
    rcv ReceiverType
}
```

The closure's call entry point:
1. Loads the captured receiver.
2. Tail-calls the underlying method.

For pointer-receiver methods, the captured `rcv` is a pointer; for value
receivers, it is a copy of the value.

### Escape Analysis

Method values almost always cause the receiver to escape to the heap because:

1. The closure containing the receiver may outlive the stack frame.
2. The compiler conservatively assumes "function value passed somewhere"
   means "escapes."

Verify with:

```bash
go build -gcflags='-m=2' ./...
```

Look for `moved to heap: x` lines.

### Method Expression Cost

Method expressions are essentially function pointers. There is no closure
allocation; only a pointer copy. Calling `T.M(t, args)` is equivalent in
cost to calling `t.M(args)`.

### Inlining

The compiler can inline calls to method values when:
- The closure is not stored in a heap object.
- The underlying method is also inlinable.
- The receiver is a small value type.

Method expressions are inlinable under the same conditions as ordinary
function calls.

---

## 11. Spec Compliance Checklist

- [ ] Method value receiver expression must evaluate without side-effects
      that affect later calls (or the side-effect must be intentional).
- [ ] Method value of a pointer-receiver method requires an addressable
      receiver.
- [ ] Method expression `T.M` is only legal when `M` has a value receiver
      (or `T` itself is a pointer type).
- [ ] Method expression `(*T).M` is legal for both pointer and value
      receivers.
- [ ] Method values are not comparable with `==` (except against `nil`).
- [ ] Generic method expressions require an instantiated type.
- [ ] Loop-captured method values (Go 1.22+) capture per-iteration
      receivers.
- [ ] Interface method values dispatch through the interface table.

---

## 12. Official Examples

### Method Value (from spec)

```go
type T struct{ a int }
func (tv  T) Mv(a int) int         { return 0 }  // value receiver
func (tp *T) Mp(f float32) float32 { return 1 }  // pointer receiver

var t T
f := t.Mv             // type: func(int) int
_ = f(7)              // equivalent to t.Mv(7)

p := &t
g := p.Mp             // type: func(float32) float32
_ = g(2.5)            // equivalent to p.Mp(2.5)
```

### Method Expression (from spec)

```go
type T struct{ a int }
func (tv  T) Mv(a int) int         { return 0 }
func (tp *T) Mp(f float32) float32 { return 1 }

var t T

// Five equivalent invocations:
_ = t.Mv(7)
_ = T.Mv(t, 7)
_ = (T).Mv(t, 7)
f1 := T.Mv;   _ = f1(t, 7)
f2 := (T).Mv; _ = f2(t, 7)

// Pointer-receiver method expression:
g := (*T).Mp           // type: func(*T, float32) float32
_ = g(&t, 1.5)

// Value-receiver method, accessed via *T:
h := (*T).Mv           // type: func(*T, int) int
_ = h(&t, 7)           // method does not overwrite *t
```

### Practical Pattern — Dispatch Table

```go
type Calc struct{}
func (Calc) Add(a, b int) int { return a + b }
func (Calc) Sub(a, b int) int { return a - b }
func (Calc) Mul(a, b int) int { return a * b }

var ops = map[string]func(Calc, int, int) int{
    "+": Calc.Add,
    "-": Calc.Sub,
    "*": Calc.Mul,
}

func Apply(op string, a, b int) int {
    return ops[op](Calc{}, a, b)
}
```

### Practical Pattern — sort.Slice with Method Value

```go
type People []Person

func (p People) lessByAge(i, j int) bool  { return p[i].Age < p[j].Age }
func (p People) lessByName(i, j int) bool { return p[i].Name < p[j].Name }

people := People{...}
sort.Slice(people, people.lessByAge)   // method value as Less callback
```

### Practical Pattern — http.Handler

```go
type Server struct{ db *sql.DB }
func (s *Server) HandleUsers(w http.ResponseWriter, r *http.Request) { ... }
func (s *Server) HandleOrders(w http.ResponseWriter, r *http.Request) { ... }

s := &Server{db: db}
http.HandleFunc("/users",  s.HandleUsers)   // method value
http.HandleFunc("/orders", s.HandleOrders)  // method value
```

---

## 13. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Method values | https://go.dev/ref/spec#Method_values | Bound function from instance + method |
| Method expressions | https://go.dev/ref/spec#Method_expressions | Unbound function from type + method |
| Selectors | https://go.dev/ref/spec#Selectors | Lookup rules for `x.f` |
| Method sets | https://go.dev/ref/spec#Method_sets | Determines which methods are accessible |
| Calls | https://go.dev/ref/spec#Calls | Function and method call rules |
| Address operators | https://go.dev/ref/spec#Address_operators | Auto-`&` for pointer-receiver methods |
| Function types | https://go.dev/ref/spec#Function_types | Types produced by method values/expressions |
| Interface types | https://go.dev/ref/spec#Interface_types | Method values on interface receivers |
| Type parameters | https://go.dev/ref/spec#Type_parameter_declarations | Method expressions on generic types |
