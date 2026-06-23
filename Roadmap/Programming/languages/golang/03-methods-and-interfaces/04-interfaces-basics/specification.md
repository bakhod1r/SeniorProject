# Interfaces Basics — Specification

> Source: [Go Language Specification](https://go.dev/ref/spec) — §Interface_types, §Method_sets, §Type_assertions

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Interface Type Rules](#3-interface-type-rules)
4. [Implementation Satisfaction](#4-implementation-satisfaction)
5. [Embedded Interfaces](#5-embedded-interfaces)
6. [Interface Values](#6-interface-values)
7. [Defined vs Undefined Behavior](#7-defined-vs-undefined-behavior)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Version History](#9-version-history)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Spec Sections](#12-related-spec-sections)

---

## 1. Spec Reference

### Interface Type — Official Text

> An interface type defines a type set. A variable of interface type can store
> a value of any type that is in the type set of the interface. Such a type
> is said to implement the interface.

Source: https://go.dev/ref/spec#Interface_types

### Method Set — Official Text

> The type set of an interface type that is the set of types that satisfy
> all of its constraints (as defined in Type set). A type T implements an
> interface I if T is in the type set of I.

Source: https://go.dev/ref/spec#Implementing_an_interface

### Implementing an Interface — Official Text

> A type T implements an interface I if
> - T is not an interface and is an element of the type set of I; or
> - T is an interface and the type set of T is a subset of the type set of I.

Source: https://go.dev/ref/spec#Implementing_an_interface

---

## 2. Formal Grammar (EBNF)

### Interface Type

```ebnf
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
MethodElem     = MethodName Signature .
MethodName     = identifier .
TypeElem       = TypeTerm { "|" TypeTerm } .
TypeTerm       = Type | UnderlyingType .
UnderlyingType = "~" Type .
```

### Method Element

```ebnf
MethodElem  = MethodName Signature .
Signature   = Parameters [ Result ] .
```

### Embedded Interface

```ebnf
InterfaceElem = MethodElem | TypeElem .   // TypeElem can be interface name
```

Embedded interface — interface element-i sifatida.

---

## 3. Interface Type Rules

### Rule 1: Interface declares method set

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

The interface defines what methods a type must have to satisfy it.

### Rule 2: Methods must have unique names

```go
type I interface {
    M()
    // M()    // illegal — duplicate method name
}
```

### Rule 3: Embedded interface members merged

```go
type A interface { Foo() }
type B interface { Bar() }

type AB interface { A; B }  // type set: {Foo, Bar}
```

### Rule 4: Method conflicts (Go 1.14+)

```go
type A interface { M() }
type B interface { M() }   // same signature

type AB interface { A; B }  // OK — single M
```

Pre-1.14 — duplicate methods compile error. 1.14+ — same signature allowed.

```go
type A interface { M() }
type B interface { M() string }   // different signature

type AB interface { A; B }   // compile error — incompatible
```

### Rule 5: Empty interface

```go
type any = interface{}    // alias (Go 1.18+)

var x any = 42
var y any = "hello"
var z any = struct{}{}
```

Any type satisfies the empty interface.

---

## 4. Implementation Satisfaction

### Rule: Method set inclusion

A type T implements interface I if T's method set includes all methods of I.

```go
type I interface { M() }

type T struct{}
func (t T) M() {}

var _ I = T{}     // OK
```

### Rule: Pointer receiver impact

If method M is declared with pointer receiver (`func (t *T) M()`), only `*T`'s
method set includes M. T's method set does not.

```go
type I interface { M() }

type T struct{}
func (t *T) M() {}

var _ I = T{}     // compile error — T does not implement I
var _ I = &T{}    // OK
```

### Implicit satisfaction

There is no `implements` keyword in Go. Satisfaction is determined by method
set inclusion at compile time.

### Compile-time assertion

```go
var _ Reader = (*MyFile)(nil)
```

The blank identifier discards the value. The compiler verifies `*MyFile`
implements `Reader`.

---

## 5. Embedded Interfaces

### Embedding

```go
type Reader interface { Read([]byte) (int, error) }
type Writer interface { Write([]byte) (int, error) }

type ReadWriter interface {
    Reader
    Writer
}
// type set: {Read, Write}
```

### Method conflict resolution (1.14+)

If embedded interfaces have methods with same name and same signature —
merged into one.

If signatures differ — compile error.

### Type element (Go 1.18+ generics)

```go
type Number interface {
    int | int64 | float64
}

type AnyNumber interface {
    ~int | ~int64 | ~float64    // ~T means T or any type with underlying T
}
```

These define type sets for generic constraints.

---

## 6. Interface Values

### Internal representation

An interface value consists of two components:

```
(type, value)
```

- **Type**: dynamic type of the stored value
- **Value**: the actual data (or pointer to it)

### Nil interface

```go
var i I              // i = (nil, nil) — nil interface
fmt.Println(i == nil) // true
```

### Non-nil interface with nil concrete

```go
var p *T = nil
var i I = p          // i = (*T, nil) — NOT nil interface
fmt.Println(i == nil) // false
```

This is a common pitfall. The interface value has type information; only the
concrete value is nil.

### Equality

Two interface values are equal if:
- Both are nil, OR
- Their dynamic types are identical AND their dynamic values are equal.

```go
var i, j I = T{}, T{}
fmt.Println(i == j)  // true if T is comparable and values equal
```

---

## 7. Defined vs Undefined Behavior

### Defined operations

| Operation | Behavior |
|-----------|---------|
| `var i I = T{}` | i = (T, T{}) — boxing if value type |
| `i.M()` | dynamic dispatch via itab |
| `v, ok := i.(T)` | type assertion — ok indicates success |
| `i == nil` | true only if i is nil interface (both type and value nil) |
| `i == j` | true if both nil or types match and values equal |
| Calling method on nil-concrete in interface | Method runs with nil receiver |

### Illegal operations

| Operation | Result |
|-----------|--------|
| Method on interface type as receiver | Compile error |
| Comparing non-comparable interface values | Runtime panic |
| Type assertion on nil interface | Compile error if type known; runtime panic with second form |

---

## 8. Edge Cases from Spec

### Edge Case 1: Interface containing non-comparable type

```go
type S struct{ items []int }

var i interface{} = S{items: []int{1}}
var j interface{} = S{items: []int{1}}

// fmt.Println(i == j)  // RUNTIME PANIC — S is non-comparable
```

Spec: comparing interface values containing non-comparable types panics.

### Edge Case 2: Method on interface

```go
type I interface { M() }

// func (i I) Foo() {}  // illegal — interface as receiver
```

### Edge Case 3: Interface as receiver elements

```go
type I interface {
    M()
}

type T struct{ I }   // embedded interface — T must contain a value of I
```

`T` automatically gets `M()` method (promoted).

### Edge Case 4: Type assertion safety

```go
var i I = T{}
v := i.(T)            // panic if i's dynamic type != T
v, ok := i.(T)        // ok = false if mismatch (no panic)
```

### Edge Case 5: Generic constraint syntax

```go
type Number interface {
    int | int64 | float64
}

func Sum[T Number](xs []T) T { ... }
```

Type elements form constraint type sets.

### Edge Case 6: Underlying type constraint

```go
type Celsius float64

type Float interface {
    ~float64
}

// Celsius satisfies Float because its underlying type is float64
```

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Interface types and implicit satisfaction. |
| Go 1.0 | Method sets formalized. |
| Go 1.14 | Embedded interfaces with same-signature methods allowed. |
| Go 1.18 | Generics: type elements (`int | float64`), type sets, `~T` constraint syntax. |
| Go 1.18 | `any` is now a predeclared alias for `interface{}`. |
| Go 1.18 | `comparable` constraint introduced. |
| Go 1.21 | `min`, `max`, `clear` added. No interface change. |

---

## 10. Spec Compliance Checklist

- [ ] Method names within an interface are unique.
- [ ] Embedded interfaces are correctly merged.
- [ ] Method signatures match for embedded interface conflicts (1.14+).
- [ ] Pointer-receiver methods are recognized only on `*T`.
- [ ] Nil interface vs nil concrete distinction understood.
- [ ] Comparable types respected when interface comparison occurs.
- [ ] Type assertion uses two-value form for safety.
- [ ] Generic constraints use type elements correctly (1.18+).

---

## 11. Official Examples

### Interface with multiple methods

```go
type ReadWriter interface {
    Reader
    Writer
}

type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

### Stringer interface (from fmt)

```go
type Stringer interface {
    String() string
}
```

### Implementation example

```go
type File struct {
    *os.File
}

func (f *File) Close() error {
    if f.File == nil { return nil }
    return f.File.Close()
}

// File satisfies io.Closer
var _ io.Closer = (*File)(nil)
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Interface types | https://go.dev/ref/spec#Interface_types | Interface declaration |
| Method sets | https://go.dev/ref/spec#Method_sets | Implementation rules |
| Implementing an interface | https://go.dev/ref/spec#Implementing_an_interface | Satisfaction rules |
| Type assertions | https://go.dev/ref/spec#Type_assertions | i.(T) semantics |
| Type switches | https://go.dev/ref/spec#Type_switches | switch v := i.(type) |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Interface == |
| Type sets | https://go.dev/ref/spec#General_interfaces | Generic constraints |
| Type parameters | https://go.dev/ref/spec#Type_parameters | Generic types |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | any, comparable, error |
