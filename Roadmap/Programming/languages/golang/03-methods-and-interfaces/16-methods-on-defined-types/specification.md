# Methods on Defined Types — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Type_definitions, §Type_declarations, §Type_identity, §Method_declarations, §Method_sets

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Type Definitions vs Type Aliases](#3-type-definitions-vs-type-aliases)
4. [Method Declaration Restrictions](#4-method-declaration-restrictions)
5. [Method Sets of Non-Struct Defined Types](#5-method-sets-of-non-struct-defined-types)
6. [Defined vs Underlying Type Behavior](#6-defined-vs-underlying-type-behavior)
7. [Defined Generic Types and Methods](#7-defined-generic-types-and-methods)
8. [Edge Cases from the Specification](#8-edge-cases-from-the-specification)
9. [Version History](#9-version-history)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples and Related Sections](#11-official-examples-and-related-sections)

---

## 1. Spec Reference

### Type Declarations — Official Text

> A type declaration binds an identifier, the type name, to a type. Type
> declarations come in two forms: alias declarations and type definitions.

Source: https://go.dev/ref/spec#Type_declarations

### Type Definitions — Official Text

> A type definition creates a new, distinct type with the same underlying type
> and operations as the given type, and binds an identifier to it.
>
> ```
> TypeDef = identifier [ TypeParameters ] Type .
> ```
>
> The new type is called a **defined type**. It is different from any other
> type, including the type it is created from.

Source: https://go.dev/ref/spec#Type_definitions

### Alias Declarations — Official Text

> An alias declaration binds an identifier to the given type.
>
> ```
> AliasDecl = identifier "=" Type .
> ```

Source: https://go.dev/ref/spec#Alias_declarations

### Method Declarations — Official Text

> A method is a function with a receiver. A method declaration binds an
> identifier, the method name, to a method, and associates the method with the
> receiver's base type.
>
> The receiver is specified via an extra parameter section preceding the
> method name in the function declaration. That parameter section must declare
> a single non-variadic parameter, the receiver. Its type must be a defined
> type T or a pointer to a defined type T, called the receiver base type. T
> must not be a pointer or interface type and **it must be defined in the same
> package as the method**.

Source: https://go.dev/ref/spec#Method_declarations

### Type Identity — Official Text

> Two types are either identical or different.
>
> A defined type is always different from any other type.

Source: https://go.dev/ref/spec#Type_identity

---

## 2. Formal Grammar (EBNF)

### Type Declaration Variants

```ebnf
TypeDecl     = "type" ( TypeSpec | "(" { TypeSpec ";" } ")" ) .
TypeSpec     = AliasDecl | TypeDef .

AliasDecl    = identifier "=" Type .
TypeDef      = identifier [ TypeParameters ] Type .

TypeParameters = "[" TypeParamList [ "," ] "]" .
```

### Method Declaration

```ebnf
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = Parameters .
```

The receiver `Parameters` block must contain exactly one parameter:

```ebnf
Receiver     = "(" [ identifier ] [ "*" ] ReceiverBaseTypeName [ TypeArgs ] ")" .
ReceiverBaseTypeName = identifier .
```

For a generic defined type, the receiver must include the type parameter list (without constraints):

```go
type List[T any] []T
func (l List[T]) Len() int { return len(l) }   // [T] required, no constraint
```

---

## 3. Type Definitions vs Type Aliases

### Type Definition (`type X Y`)

> The new type is called a defined type. It is **different from any other
> type**, including the type it is created from.

```go
type Counter int

var c Counter = 42
var n int = 7

// c = n             // ERROR: cannot use n (int) as Counter
// n = c             // ERROR: cannot use c (Counter) as int
c = Counter(n)        // OK — explicit conversion
n = int(c)            // OK — explicit conversion
```

### Type Alias (`type X = Y`)

> An alias declaration binds an identifier to the given type.

```go
type Number = int     // alias

var c Number = 42
var n int = 7

c = n                 // OK — Number IS int
n = c                 // OK — int IS Number
```

The alias is *literally* the same type. There is no conversion required, and there is no separate identity.

### Method Set Consequence

| Form | Can declare new methods on it? |
|------|-------------------------------|
| `type X Y` | YES (X has its own method set) |
| `type X = Y` | NO (X is just another name for Y; methods would belong to Y) |

The spec confirms:

> Methods may be declared on any defined type whose underlying type is not a
> pointer or interface type.

An alias is not a defined type. Therefore methods cannot be declared on an alias.

```go
type Counter int
func (c Counter) Inc() Counter { return c + 1 }    // OK

type Number = int
// func (n Number) Inc() Number { return n + 1 }   // ERROR
```

The error message is, paraphrased: *"cannot define new methods on non-local type int"*. The compiler treats `Number` as `int`, and `int` is not declared in your package.

### Underlying Type

The spec defines the **underlying type** recursively:

> Each type T has an underlying type:
>   - If T is one of the predeclared boolean, numeric, or string types, or a
>     type literal, the corresponding underlying type is T itself.
>   - Otherwise, T's underlying type is the underlying type of the type to
>     which T refers in its declaration.

Examples:

```go
type A int                    // underlying type: int
type B A                      // underlying type: int (recursively from A)
type C = B                    // C is B; underlying type still int
type D []int                  // underlying type: []int
type E []A                    // underlying type: []A (NOT []int)
```

The underlying type determines:
- Which conversions are legal (`Counter(42)` requires `int` and `Counter` share underlying `int`).
- Which operators are legal (`+`, `<`, etc.).
- Whether the type is comparable.

---

## 4. Method Declaration Restrictions

### Restriction 1: Receiver Base Type Must Be Defined

```go
type Counter int
func (c Counter) Inc() {}    // OK

// ILLEGAL — int is predeclared, not "your" defined type
// func (i int) Inc() {}     // compile error: cannot define new methods on non-local type int
```

### Restriction 2: Same-Package Rule

> T must not be a pointer or interface type and **it must be defined in the
> same package as the method**.

```go
import "time"

// ILLEGAL — time.Duration is defined in package time
// func (d time.Duration) IsLong() bool { return d > time.Hour }
```

The fix: define a local type that wraps `time.Duration`:

```go
type LongDuration time.Duration
func (d LongDuration) IsLong() bool { return time.Duration(d) > time.Hour }
```

`LongDuration` has the same underlying type as `time.Duration` but is a distinct, package-local defined type, so methods are allowed.

### Restriction 3: Pointer Base Type Forbidden

> T must not be a pointer or interface type.

```go
type T int
type P *T

// ILLEGAL
// func (p P) M() {}      // compile error: invalid receiver type P
```

Receivers can be a *pointer to a defined type* (`*T`), but the **base type** itself must not be a pointer.

### Restriction 4: Interface Base Type Forbidden

```go
type Reader interface { Read([]byte) (int, error) }

// ILLEGAL
// func (r Reader) Hello() {}  // compile error: invalid receiver type Reader (Reader is an interface type)
```

Methods on interfaces are declared **inside the interface body** (as part of the interface definition), not as separate `func` declarations.

### Restriction 5: Receiver Methods Cannot Have Their Own Type Parameters

```go
type Stack[T any] []T

// ILLEGAL — methods cannot introduce type parameters of their own
// func (s Stack[T]) Map[U any](f func(T) U) Stack[U] { ... }
```

### Restriction 6: Method Names Must Be Unique Per Type

```go
type Counter int
func (c Counter) Inc() Counter { return c + 1 }
// func (c Counter) Inc() {}   // ERROR — Inc redeclared
```

This applies even if the signatures differ — Go does not support method overloading.

### Restriction 7: Anonymous Type Literal Cannot Have Methods

```go
// ILLEGAL — []int is an unnamed type literal
// func (s []int) Sum() int { ... }

// CORRECT — define a named type first
type IntSlice []int
func (s IntSlice) Sum() int { ... }
```

The receiver must be a *defined type name* (or pointer to one), not a type literal.

---

## 5. Method Sets of Non-Struct Defined Types

The rules for method sets apply uniformly: it does not matter whether the underlying type is a struct, a primitive, a slice, a map, or a function. The spec text is the same.

### Method Set of T

> The method set of a defined type T consists of all methods declared with
> receiver type T.

```go
type Counter int
func (c Counter) Inc() Counter { return c + 1 }      // method set of Counter: {Inc}
func (c *Counter) Reset()      { *c = 0 }            // method set of *Counter only: {Reset, Inc}
```

### Method Set of *T

> The method set of a pointer type *T (where T is neither a pointer nor an
> interface type) is the set of all methods declared with receiver *T or T.

| Receiver in declaration | In method set of `T` (non-struct) | In method set of `*T` |
|-------------------------|----------------------------------|----------------------|
| `func (c T) M()` | Yes | Yes |
| `func (c *T) M()` | No | Yes |

### Why Map and Function Defined Types Often Use Value Receivers

A map is a *reference type*. Even when you pass it by value, mutations propagate to the caller:

```go
type StringSet map[string]struct{}

func (s StringSet) Add(v string) { s[v] = struct{}{} }   // value receiver works
```

A function value is also a reference. The same applies — value receivers usually suffice.

A slice is more nuanced. Value receivers work for read-only methods, but mutations to length (append, reset) require a pointer receiver:

```go
type IntSlice []int

func (s IntSlice)  Sum() int       { /* read */ ... }       // value OK
func (s *IntSlice) Reset()         { *s = (*s)[:0] }        // pointer required
func (s *IntSlice) Append(v int)   { *s = append(*s, v) }   // pointer required
```

### Interface Implementation

```go
type Sortable interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}

type IntSlice []int
func (s IntSlice) Len() int           { return len(s) }
func (s IntSlice) Less(i, j int) bool { return s[i] < s[j] }
func (s IntSlice) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

var _ Sortable = IntSlice(nil)        // OK — IntSlice satisfies Sortable
```

This is the exact pattern the standard library's `sort.IntSlice` follows.

---

## 6. Defined vs Underlying Type Behavior

### Operators and the Underlying Type

> The underlying type of T determines which operators apply.

```go
type Counter int
var c Counter = 5
var d Counter = 3

c = c + d     // OK — int supports +
c = c * d     // OK
c = c << 2    // OK
```

The operator `+` is valid because the *underlying* type of `Counter` is `int`. But you cannot mix `Counter` and `int` directly:

```go
// c = c + 1     // OK — untyped constant 1 can be assigned to Counter
var n int = 5
// c = c + n     // ERROR — different types
c = c + Counter(n) // OK
```

### Conversions

> A non-constant value x can be converted to type T if x's type and T have
> identical underlying types (ignoring struct tags).

```go
type A int
type B int
type C = int

var a A = 1
var b B
b = B(a)      // OK — both have underlying int
var n int
n = int(a)    // OK
n = C(a)      // OK — C is int
```

### Comparability

A defined type is comparable if and only if its **underlying type** is comparable:

| Defined type | Underlying | Comparable? |
|--------------|-----------|-------------|
| `type Counter int` | `int` | Yes |
| `type ID string` | `string` | Yes |
| `type IntSlice []int` | `[]int` | No (slices not comparable) |
| `type Set map[string]bool` | `map[string]bool` | No (maps not comparable) |
| `type Handler func(int) int` | `func(int) int` | Only against `nil` |

### Stringer Interface and `fmt`

The `fmt` package detects the `Stringer` method on **any defined type**:

```go
type Status int

const (
    Pending Status = iota
    Active
    Closed
)

func (s Status) String() string {
    switch s {
    case Pending: return "pending"
    case Active:  return "active"
    case Closed:  return "closed"
    }
    return "unknown"
}

fmt.Println(Active)  // "active"  ← uses String()
```

This works regardless of whether the underlying type is `int`, `string`, a slice, or a function.

### Methods on `time.Duration` (canonical example)

```go
package time

type Duration int64

func (d Duration) Hours() float64    { ... }
func (d Duration) Minutes() float64  { ... }
func (d Duration) Seconds() float64  { ... }
func (d Duration) String() string    { ... }
```

`time.Duration` is a defined type with underlying type `int64`. It supports arithmetic via the underlying type, *and* it has a rich method set. This is the textbook example of the pattern.

---

## 7. Defined Generic Types and Methods

> A method declaration on a parameterized type must use the same number of
> type parameters as the type, and the type parameters in the method
> declaration must be identifiers, not types.

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T)        { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool   { _, ok := s[v]; return ok }
func (s Set[T]) Remove(v T)     { delete(s, v) }
```

### Required: Identifiers Only

```go
// ILLEGAL — receiver type parameter must be an identifier, not a concrete type
// func (s Set[int]) AddInt(v int) { ... }
```

### Required: No Constraints in the Method Receiver

```go
// ILLEGAL — constraint in receiver
// func (s Set[T comparable]) Add(v T) { ... }

// CORRECT
func (s Set[T]) Add(v T) { ... }
```

The constraint is declared once, in the type definition. The method receiver merely re-binds the parameter name.

### Forbidden: Method-Level Type Parameters

```go
type Stack[T any] []T

// ILLEGAL
// func (s Stack[T]) Map[U any](f func(T) U) Stack[U] { ... }
```

Top-level functions can introduce additional type parameters:

```go
func Map[T, U any](s Stack[T], f func(T) U) Stack[U] {
    out := make(Stack[U], 0, len(s))
    for _, x := range s {
        out = append(out, f(x))
    }
    return out
}
```

### Method Set of an Instantiated Generic Type

```go
ints := Set[int]{}
ints.Add(7)         // OK — method on Set[int]
strs := Set[string]{}
strs.Add("hi")      // OK — method on Set[string]
```

Each instantiation `Set[int]`, `Set[string]` has its own method set, but the methods are all generated from the same source-level declaration.

---

## 8. Edge Cases from the Specification

### Edge Case 1: Defined Type Whose Underlying Is Another Defined Type

```go
type A int
type B A     // underlying type of B is int (NOT A)

func (a A) Hello() string { return "A" }
// Method set of B does NOT contain Hello — B is a separate defined type.
```

The spec is explicit: *the underlying type of a defined type T is the underlying type of the type to which T refers in its declaration*. The methods of `A` are **not** inherited by `B`. To get behavior, you would have to redeclare or use embedding (which requires a struct).

### Edge Case 2: Method on a Function-Type Receiver

```go
type Greeter func(string) string

func (g Greeter) Wrap() Greeter {
    return func(s string) string { return "[" + g(s) + "]" }
}

var hello Greeter = func(name string) string { return "hello, " + name }
wrapped := hello.Wrap()
fmt.Println(wrapped("Alice"))   // [hello, Alice]
```

Legal — the receiver is a defined type whose underlying type is a function literal. Function types are not pointer or interface types, so the spec permits them.

### Edge Case 3: `http.HandlerFunc` Pattern

```go
package http

type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

The conversion `HandlerFunc(myFunc)` succeeds because `myFunc`'s type and `HandlerFunc` share the same underlying signature. The conversion grants `myFunc` the `ServeHTTP` method, which makes it satisfy the `Handler` interface.

### Edge Case 4: Method on a Defined Pointer Type — Forbidden

```go
type T int
type P *T

// ILLEGAL
// func (p P) M() {}
```

The receiver base type cannot be a pointer. Even though `P` is a defined type, its underlying type `*T` is a pointer. The spec rejects this.

### Edge Case 5: Method on a Defined Interface Type — Forbidden

```go
type R interface { Read([]byte) (int, error) }

// ILLEGAL
// func (r R) Hello() {}
```

Interfaces cannot be receiver base types because the method set of an interface is part of its definition; adding methods externally would break the interface's static method set.

### Edge Case 6: Type Alias to a Type from Another Package

```go
import "time"

type Dur = time.Duration   // alias

// ILLEGAL — Dur is time.Duration; methods belong to time package
// func (d Dur) IsLong() bool { ... }
```

The compile error references the original package: *"cannot define new methods on non-local type time.Duration"*.

To make this work, switch from alias to defined type:

```go
type Dur time.Duration         // defined type, not alias
func (d Dur) IsLong() bool { return time.Duration(d) > time.Hour }
```

### Edge Case 7: Method on Generic Type Without Type Parameter List

```go
type List[T any] []T

// ILLEGAL — receiver must include [T]
// func (l List) Len() int { return len(l) }

// CORRECT
func (l List[T]) Len() int { return len(l) }
```

### Edge Case 8: Conversion Between Defined Types with Same Underlying

```go
type A int
type B int

var a A = 5
var b B = B(a)      // OK — same underlying int
```

Conversion is allowed even though `A` and `B` are distinct types, because their underlying types are identical.

### Edge Case 9: Defined Slice Type — Sortability

```go
type IntSlice []int

func (s IntSlice) Len() int           { return len(s) }
func (s IntSlice) Less(i, j int) bool { return s[i] < s[j] }
func (s IntSlice) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

sort.Sort(IntSlice([]int{3, 1, 2}))
```

This is the actual pattern of `sort.IntSlice` in the standard library.

### Edge Case 10: Defined Type Adoption of a Method on an Embedded Type

You cannot embed a non-struct defined type for method promotion. Embedding is a struct feature:

```go
type A int
func (a A) Hello() {}

// type B struct { A }   // OK — Hello promoted via embedding

// type C A              // does NOT promote Hello — C is a separate defined type
```

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Type definitions and method declarations introduced. Same-package, non-pointer, non-interface receiver rule established. |
| Go 1.0 | Standard library types `time.Duration`, `sort.IntSlice`, `syscall.Errno`, `http.HandlerFunc` set the canonical patterns. |
| Go 1.9 | Type aliases (`type X = Y`) added — explicitly prohibited from having methods. |
| Go 1.18 | Generics introduced. Type parameters allowed in `TypeDef`. Methods on generic types must repeat the type parameter list (without constraints) and cannot introduce their own type parameters. |
| Go 1.22 | Loop variable semantics changed. Affects method values created inside loops, regardless of receiver type. |

---

## 10. Spec Compliance Checklist

- [ ] Receiver is a defined type (not an alias).
- [ ] Receiver is defined in the same package as the method.
- [ ] Receiver base type is not a pointer (`*T` allowed; `**T` forbidden).
- [ ] Receiver base type is not an interface.
- [ ] Receiver base type is not an unnamed type literal (`[]int`, `map[string]bool` directly).
- [ ] Method names are unique per type (no overloading).
- [ ] Generic receiver includes its type parameter list without constraints.
- [ ] Method does not introduce its own type parameters.
- [ ] Conversions between defined types and their underlying types are explicit.
- [ ] Type alias is used only for migration; defined type is used when behavior is needed.
- [ ] Embedding is used (with a struct) when methods of one type should be inherited by another.
- [ ] Stringer/Error/Marshaler interfaces are implemented as needed for fmt and encoding/json/database/sql interop.

---

## 11. Official Examples and Related Sections

### Defined Type with Methods — From the Spec

```go
type IntSlice []int

func (s IntSlice) Search(x int) int {
    return sort.SearchInts([]int(s), x)
}
```

The conversion `[]int(s)` is required because `sort.SearchInts` expects `[]int`, not `IntSlice`. Even though the underlying types are identical, the static type names differ.

### Method on a Defined Function Type — `http.HandlerFunc`

```go
type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

### Method on a Defined Integer Type — `time.Duration`

```go
type Duration int64

const Hour = 60 * Minute

func (d Duration) Hours() float64   { ... }
func (d Duration) Minutes() float64 { ... }
func (d Duration) String() string   { ... }
```

### Method on a Defined Integer Type — `syscall.Errno`

```go
type Errno uintptr

func (e Errno) Error() string     { ... }
func (e Errno) Is(target error) bool { ... }
func (e Errno) Temporary() bool   { ... }
func (e Errno) Timeout() bool     { ... }
```

### Method on a Defined Slice Type — `sort.StringSlice`

```go
type StringSlice []string

func (p StringSlice) Len() int           { return len(p) }
func (p StringSlice) Less(i, j int) bool { return p[i] < p[j] }
func (p StringSlice) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p StringSlice) Sort()              { Sort(p) }
```

### Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Type declarations | https://go.dev/ref/spec#Type_declarations | Top-level grammar |
| Type definitions | https://go.dev/ref/spec#Type_definitions | Defined types create distinct identity |
| Alias declarations | https://go.dev/ref/spec#Alias_declarations | Why aliases cannot have methods |
| Type identity | https://go.dev/ref/spec#Type_identity | Distinct vs identical types |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Receiver base type rules |
| Method sets | https://go.dev/ref/spec#Method_sets | Method set membership |
| Type parameter declarations | https://go.dev/ref/spec#Type_parameter_declarations | Generic types |
| Conversions | https://go.dev/ref/spec#Conversions | Explicit conversions between defined types |
| Operators | https://go.dev/ref/spec#Operators | Operators apply via underlying type |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Comparability through underlying type |
