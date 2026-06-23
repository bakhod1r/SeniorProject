# Methods vs Functions — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Function_declarations, §Method_declarations, §Method_sets, §Method_values, §Method_expressions

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type Rules](#4-type-rules)
5. [Method Sets — Formal Definition](#5-method-sets-formal-definition)
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

### Function Declaration — Official Text

> A function declaration binds an identifier, the function name, to a function.

Source: https://go.dev/ref/spec#Function_declarations

### Method Declaration — Official Text

> A method is a function with a receiver. A method declaration binds an
> identifier, the method name, to a method, and associates the method with the
> receiver's base type.

Source: https://go.dev/ref/spec#Method_declarations

### Receiver Restrictions — Official Text

> The type denoted by `T` is called the receiver base type. It must be a
> defined type defined in the same package as the method. The method is said
> to be bound to its receiver base type and the method name is visible only
> within selectors for type `T` or `*T`.

Source: https://go.dev/ref/spec#Method_declarations

### Method Sets — Official Text

> The method set of a type determines the interfaces that the type implements.
> The method set of a defined type T consists of all methods declared with
> receiver type T. The method set of a pointer to a defined type T (where T is
> neither a pointer nor an interface) is the set of all methods declared with
> receiver `*T` or `T`. Further rules apply to structs containing embedded
> fields.

Source: https://go.dev/ref/spec#Method_sets

---

## 2. Formal Grammar (EBNF)

### Function Declaration

```ebnf
FunctionDecl = "func" FunctionName Signature [ FunctionBody ] .
FunctionName = identifier .
FunctionBody = Block .
Signature    = Parameters [ Result ] .
Parameters   = "(" [ ParameterList [ "," ] ] ")" .
Result       = Parameters | Type .
```

### Method Declaration

```ebnf
MethodDecl = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver   = Parameters .
MethodName = identifier .
```

### Receiver Form (1 parameter)

```ebnf
Receiver        = "(" [ identifier ] [ "*" ] BaseTypeName ")" .
BaseTypeName    = identifier .
```

### Method Value & Expression

```ebnf
MethodValue      = PrimaryExpr "." MethodName .
MethodExpression = ReceiverType "." MethodName .
ReceiverType     = Type .
```

---

## 3. Core Rules & Constraints

### Rule 1 — Receiver Base Type Restrictions

The receiver base type **must satisfy all of**:
1. Be a **defined type** (not a type alias).
2. Be defined in the **same package** as the method.
3. Be neither a **pointer type** nor an **interface type**.

```go
// Legal
type T int
func (t T) M() {}                  // OK

// Illegal — pointer base type
// func (p *int) M() {}            // compile error

// Illegal — interface base type
// type I interface{}
// func (i I) M() {}               // compile error

// Illegal — different package
// func (t time.Time) M() {}       // compile error
```

### Rule 2 — Receiver Naming

The receiver identifier is optional. If omitted (blank receiver), the method is
declared but the receiver value cannot be referenced inside the body:

```go
type T struct{}
func (T) Hello() string { return "hi" }  // legal — no receiver name
```

### Rule 3 — Receiver May Be Pointer or Value

```go
type T struct{}
func (t T)  Value()   {}  // value receiver
func (t *T) Pointer() {}  // pointer receiver
```

### Rule 4 — Method Names Must Be Unique Per Type

```go
type T struct{}
func (T) M() {}
// func (T) M() {}    // illegal: T.M already declared
```

### Rule 5 — Methods on Generic Types

A method on a generic type **must** repeat the type parameter list (without
constraints) of the receiver:

```go
type List[T any] struct { items []T }

func (l *List[T]) Add(x T) { ... }   // [T] required
```

### Rule 6 — Methods Cannot Have Their Own Type Parameters

```go
// Illegal
// func (l *List[T]) Map[U any](...) { ... }
```

This restriction is intentional in Go 1.18+ generics design.

---

## 4. Type Rules

### Function Type

A function type denotes the set of all functions with the same parameter and
result types. Functions are first-class values.

```go
type Op func(int, int) int  // function type
var add Op = func(a, b int) int { return a + b }
```

### Method Type via Method Expression

A method expression `T.M` yields a function value where the receiver becomes
the **first parameter**:

```go
type T struct{}
func (t T) M(x int) int { return x }

f := T.M       // type: func(T, int) int
result := f(T{}, 42)
```

### Method Type via Method Value

A method value `t.M` yields a function value where the receiver is bound:

```go
t := T{}
g := t.M       // type: func(int) int — receiver bound
result := g(42)
```

---

## 5. Method Sets — Formal Definition

### Type T (non-pointer, non-interface)

> The method set of type T consists of all methods declared with receiver type T.

| Receiver in declaration | In method set of T? |
|-------------------------|--------------------|
| `func (t T) M()`        | ✅ Yes |
| `func (t *T) M()`       | ❌ No |

### Type *T

> The method set of pointer type *T (where T is neither a pointer nor an
> interface type) is the set of all methods declared with receiver *T or T.

| Receiver in declaration | In method set of *T? |
|-------------------------|----------------------|
| `func (t T) M()`        | ✅ Yes |
| `func (t *T) M()`       | ✅ Yes |

### Type I (interface)

The method set of an interface type is its **interface**: the set of methods
explicitly declared in it (and any embedded interfaces).

### Type S with embedded field

If `S` contains an embedded field `T`:
- Methods of `T` are **promoted** to the method set of `S`.
- If `*T` is embedded, both methods of `T` and `*T` are promoted to `S`.

---

## 6. Behavioral Specification

### Method Selection

When evaluating `x.M`:

1. Compiler looks up `M` in the method set of `x`'s type.
2. If `x.M` is a method value, the receiver is "bound" — `x` is captured.
3. If `x` is addressable and `M` has a pointer receiver, the compiler
   automatically takes `&x`.
4. If `x` is a pointer and `M` has a value receiver, the compiler
   automatically dereferences `*x` (always allowed).

### Method Value Semantics

A method value evaluates the receiver expression **once**, at the point of
the method value creation:

```go
type Counter struct{ n int }
func (c Counter) Get() int { return c.n }

c := Counter{n: 1}
get := c.Get      // c (with n=1) captured by value
c.n = 99
fmt.Println(get()) // 1 — original captured value
```

For pointer receiver methods, the **pointer** is captured (so subsequent
mutations are observable):

```go
func (c *Counter) Inc() { c.n++ }
c := &Counter{}
inc := c.Inc      // pointer captured
c.n = 100
inc()
fmt.Println(c.n)  // 101
```

### Method Expression Semantics

A method expression does NOT bind a receiver — receiver is passed at call
time:

```go
f := Counter.Get  // type: func(Counter) int
fmt.Println(f(Counter{n: 5})) // 5
```

---

## 7. Defined vs Undefined Behavior

### Defined Operations

| Operation | Behavior |
|-----------|---------|
| `func (t T) M()` | M added to method set of T |
| `func (t *T) M()` | M added to method set of *T (only) |
| `t.M()` where t is T | static dispatch |
| `t.M()` via interface | dynamic dispatch via itab |
| `t.M` (no parens) | method value (closure) |
| `T.M` | method expression |
| `(*T).M` | method expression with explicit pointer |

### Illegal Operations

| Operation | Result |
|-----------|--------|
| Receiver type from another package | compile error |
| Receiver type alias (`type X = Y`) | compile error if Y not in same package |
| Duplicate method on same type | compile error: redeclared |
| Method on non-defined type | compile error |
| Method with type parameters of its own | compile error (Go 1.18+) |
| `m["k"].M()` for pointer receiver M | compile error: cannot take address |

### Undefined Behavior

Go specification does not leave any of the above as **undefined** — all are
either legal or compile errors. Runtime undefined behavior in this domain is
limited to:

- Calling a method on a nil pointer where the method dereferences the
  receiver: **runtime panic** (not undefined; it's defined as panic).

---

## 8. Edge Cases from Spec

### Edge Case 1 — Method on Slice Type

```go
type IntSlice []int
func (s IntSlice) Sum() int {
    total := 0
    for _, v := range s { total += v }
    return total
}
```

Legal — `IntSlice` is a defined type.

### Edge Case 2 — Method on Function Type

```go
type Handler func(string) string
func (h Handler) Wrap() Handler {
    return func(s string) string { return "[" + h(s) + "]" }
}
```

Legal — function types can have methods.

### Edge Case 3 — Embedded Method Promotion Conflict

```go
type A struct{}; func (A) M() string { return "A" }
type B struct{}; func (B) M() string { return "B" }

type C struct{ A; B }

var c C
// c.M()   // ambiguous: A.M and B.M both promoted
c.A.M()    // explicit — OK
c.B.M()    // explicit — OK
```

Spec says ambiguous selectors are compile errors.

### Edge Case 4 — Nil Receiver

```go
type T struct{}
func (t *T) Greet() string {
    if t == nil { return "hello, nil" }
    return "hello"
}

var p *T = nil
fmt.Println(p.Greet())  // OK — "hello, nil"
```

Legal: a nil pointer can be a receiver if the method handles `nil`.

### Edge Case 5 — Method Set of Map/Slice/Chan Element

The spec says map values are not addressable. A pointer-receiver method
cannot be called on a map element directly:

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

m := map[string]T{"k": {}}
// m["k"].Inc()  // compile error: cannot take address of m["k"]

// Workaround
v := m["k"]
v.Inc()
m["k"] = v
```

### Edge Case 6 — Method Expression Across Packages

The receiver type may be from another package, since method expressions are
formed externally:

```go
import "strings"
// fn := strings.Builder.WriteString  // OK — method expression
```

### Edge Case 7 — Method on Pointer-to-Pointer

```go
// Illegal — receiver base type cannot be pointer
// func (t **T) M() {}
```

Receivers may have at most one level of indirection.

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Function and method declarations introduced as core language. |
| Go 1.0     | Method sets and method values defined. |
| Go 1.4     | Method values and expressions formalized in spec. |
| Go 1.18    | Generics introduced. Methods on generic types: must repeat type parameter list (without constraints). Methods cannot have their own type parameters. |
| Go 1.21    | `clear`, `min`, `max` predeclared identifiers — no method/function semantic change. |
| Go 1.22    | Loop variable semantics changed (per-iteration variable). Affects method values created inside loops. |

---

## 10. Implementation-Specific Behavior

### Compiler Optimizations

- Static method calls may be **inlined** by the compiler.
- Method values where the receiver does not escape may be allocated on the
  stack rather than the heap.
- Interface method calls go through the **interface table (itab)** — small
  but measurable overhead vs. static calls.

### Linker Behavior

Unused exported methods are not eliminated by the linker (they are part of
the public API). Unused unexported methods may be dead-code eliminated.

### Race Detector

`-race` flag detects data races on receiver fields when concurrent method
calls share state without synchronization.

---

## 11. Spec Compliance Checklist

- [ ] Receiver base type is a defined type in the same package.
- [ ] Receiver base type is neither a pointer type nor an interface type.
- [ ] Method names are unique per type.
- [ ] Method on generic type repeats the type parameter list without
      constraints.
- [ ] No method has its own type parameters.
- [ ] Method values capture the receiver at the point of expression
      evaluation.
- [ ] Method expressions take the receiver as the first parameter.
- [ ] Pointer-receiver methods called on map elements use a temporary
      variable (since map elements are not addressable).
- [ ] Embedded field method promotion is unambiguous.
- [ ] Functions are not declared with receivers.

---

## 12. Official Examples

### Function Declarations (from spec)

```go
func IndexRune(s string, r rune) int {
    for i, c := range s {
        if c == r { return i }
    }
    return -1
}

func min(x int, y int) int {
    if x < y { return x }
    return y
}

func flushICache(begin, end uintptr) // no body, declared elsewhere
```

### Method Declarations (from spec)

```go
type Point struct { x, y float64 }

func (p *Point) Length() float64 {
    return math.Sqrt(p.x*p.x + p.y*p.y)
}

func (p *Point) Scale(factor float64) {
    p.x *= factor
    p.y *= factor
}
```

### Method Set Examples

```go
type T struct{}

func (t  T) V() {}   // method set of T:  {V}
func (t *T) P() {}   // method set of *T: {V, P}

var v T
var p *T = &v

// v.V() — OK
// v.P() — OK only if v is addressable; equivalent to (&v).P()
// p.V() — OK; equivalent to (*p).V()
// p.P() — OK
```

### Method Value & Expression (from spec)

```go
type T struct{ a int }
func (tv  T) Mv(a int) int   { return tv.a + a }
func (tp *T) Mp(f float32) float32 { return float32(tp.a) + f }

var t T
f1 := t.Mv               // method value, type: func(int) int
f2 := T.Mv               // method expression, type: func(T, int) int
f3 := (*T).Mp            // method expression, type: func(*T, float32) float32

_ = f1(7)
_ = f2(t, 7)
_ = f3(&t, 1.5)
```

---

## 13. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Function declarations | https://go.dev/ref/spec#Function_declarations | Function syntax, restrictions |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Method syntax, receiver rules |
| Method sets | https://go.dev/ref/spec#Method_sets | Methods belonging to types |
| Method values | https://go.dev/ref/spec#Method_values | Bound method expressions |
| Method expressions | https://go.dev/ref/spec#Method_expressions | Type-level method references |
| Selectors | https://go.dev/ref/spec#Selectors | `x.f` lookup rules |
| Type identity | https://go.dev/ref/spec#Type_identity | Defined vs alias types |
| Interface types | https://go.dev/ref/spec#Interface_types | Method set semantics for interfaces |
| Calls | https://go.dev/ref/spec#Calls | Function and method call semantics |
| Address operators | https://go.dev/ref/spec#Address_operators | Auto-`&` in method calls |
