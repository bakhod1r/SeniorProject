# Cross-Package Methods — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Method_declarations, §Type_definitions, §Type_identity, §Alias_declarations

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules and Constraints](#3-core-rules-and-constraints)
4. [Defined Type vs Type Alias](#4-defined-type-vs-type-alias)
5. [Sanctioned Workarounds](#5-sanctioned-workarounds)
6. [Behavioral Specification](#6-behavioral-specification)
7. [Method Sets Across Wrappers and Embedding](#7-method-sets-across-wrappers-and-embedding)
8. [Edge Cases from Spec](#8-edge-cases-from-spec)
9. [Version History](#9-version-history)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Related Spec Sections](#11-related-spec-sections)

---

## 1. Spec Reference

### Method Declaration — Receiver Restriction (Official Text)

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

The phrase **"defined in the same package as the method"** is the entire foundation of cross-package method discussion.

### Type Definitions (Official Text)

> A type definition creates a new, distinct type with the same underlying type
> and operations as the given type and binds an identifier, the type name, to
> it. The new type is called a defined type. It is different from any other
> type, including the type it is created from.

Source: https://go.dev/ref/spec#Type_definitions

A defined type creates a fresh identity. That identity lives in the package where the `type X T` declaration is written — making it eligible to receive methods declared in that same package.

### Alias Declarations (Official Text)

> An alias declaration binds an identifier to the given type. ... Within the
> scope of the identifier, it serves as an alias for the type.

Source: https://go.dev/ref/spec#Alias_declarations

An alias is **the same type** as its target. It does not create a new identity, so it does not gain a fresh method set, and it does not change the package the type is defined in.

### Type Identity — Defined Types (Official Text)

> Two defined types are always different. ... A defined type is always
> different from any other type. ... A non-defined type is identical to
> another type if they have identical type definitions.

Source: https://go.dev/ref/spec#Type_identity

This is why `time.Time` and `type MyTime time.Time` cannot be substituted for one another without an explicit conversion.

---

## 2. Formal Grammar (EBNF)

### Method Declaration

```ebnf
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = "(" [ identifier ] [ "*" ] BaseTypeName ")" .
BaseTypeName = identifier .
```

`BaseTypeName` is a **single identifier**. Qualified names like `time.Time` are not permitted. This grammar restriction alone forbids `func (t time.Time) M() {}`.

### Type Declarations

```ebnf
TypeDecl     = "type" ( TypeSpec | "(" { TypeSpec ";" } ")" ) .
TypeSpec     = AliasDecl | TypeDef .
AliasDecl    = identifier "=" Type .
TypeDef      = identifier [ TypeParameters ] Type .
```

The `=` sign is the syntactic discriminator between alias and definition.

### Receiver Type — Restated

The receiver type must be one of:

```ebnf
Receiver = "(" identifier_opt [ "*" ] DefinedTypeNameInThisPackage ")" .
```

Anything else is a compile error.

---

## 3. Core Rules and Constraints

### Rule 1 — Receiver Type Must Be Locally Defined

```go
// Same package as int? No — int is predeclared.
// func (i int) M() {}                  // compile error

// Same package as time.Time? Only the time package can.
// func (t time.Time) M() {}            // compile error

// Defined type in this package — OK.
type MyInt int
func (m MyInt) M() {}                   // legal
```

The compiler reports something like:

```
cannot define new methods on non-local type time.Time
```

### Rule 2 — Why the Rule Exists

The same-package rule prevents two libraries from declaring the same method on the same type. If method extension were permitted across packages:

- Two imports could each add `Format()` to `time.Time`.
- The set of methods on a value would depend on the importer's transitive imports.
- Method lookup would lose its single-source-of-truth property.

By limiting method declarations to the type's defining package, Go guarantees:

1. The method set of a type is fully knowable from one package.
2. No diamond import can introduce method conflicts.
3. Removing or adding a method has predictable scope.

### Rule 3 — The Receiver Base Type Is Followed Through Pointers

```go
type T int
func (t  T) A()   {}      // OK — base type T in this package
func (p *T) B()   {}      // OK — pointer to T, base type still T
```

But not through pointer composition:

```go
// func (pp **T) C() {}   // compile error — receiver base type cannot be a pointer
```

Receivers permit at most one level of indirection.

### Rule 4 — Aliases Do Not Change the Defining Package

```go
package mypkg

import "time"

type MyTime = time.Time            // alias

// func (m MyTime) Foo() {}        // compile error
//                                 // MyTime is identical to time.Time;
//                                 // method must live in package time.
```

The alias is `time.Time` by another name. A method declaration on it would be a method declaration on `time.Time` — illegal from `mypkg`.

### Rule 5 — Generic Type Aliases (Go 1.24+) Have the Same Restriction

Go 1.24 introduced parameterized type aliases:

```go
type Stack[T any] = []T            // generic alias (Go 1.24+)
```

Even with parameters, an alias is identical to its right-hand side. Methods cannot be declared on it because the underlying type is not defined in this package:

```go
// func (s Stack[T]) Push(x T) {}  // compile error — Stack is an alias of []T
```

To attach methods, define the type instead:

```go
type Stack[T any] []T              // type definition, not alias
func (s *Stack[T]) Push(x T) { *s = append(*s, x) }   // legal
```

### Rule 6 — Interface Method Sets Are Built from Declarations

The method set of `time.Time` is the set of methods **declared in package `time`** with `time.Time` (or `*time.Time`) as receiver. Nothing a third-party package does can grow that set.

This is consistent with §Method_sets:

> The method set of a defined type T consists of all methods declared with
> receiver type T.

"declared with receiver type T" — and those declarations can only happen in T's defining package by Rule 1.

---

## 4. Defined Type vs Type Alias

### Defined Type (`type T1 T0`)

Creates a new type identity:

```go
type Celsius float64        // defined type
```

- Underlying type: `float64`.
- Method set: empty (until methods are declared).
- Conversions to/from `float64` require explicit syntax: `Celsius(x)`, `float64(c)`.
- Can have methods declared on it in this package.

### Type Alias (`type T1 = T0`)

Does not create a new identity:

```go
type Temperature = float64  // alias
```

- `Temperature` is `float64` for every purpose: type identity, method set, package association.
- No conversion is needed; assignment works directly.
- Cannot receive methods declared in this package (because `float64` is predeclared, and aliases share that defining package).

### Side-by-side comparison

| Property | `type T1 T0` (defined) | `type T1 = T0` (alias) |
|----------|------------------------|------------------------|
| New type identity | Yes | No |
| Inherits method set of T0 | No (fresh, empty) | Yes (literally the same set) |
| Methods declarable here | Yes | No (unless T0 is in this package) |
| Conversion needed | Yes (`T1(x)` and `T0(y)`) | No |
| Use in interface satisfaction | Independent | Identical to T0 |

### Demonstration

```go
package demo

import "time"

type Defined  time.Time          // defined
type Aliased = time.Time         // alias

// On Defined — legal:
func (d Defined) Tag() string { return time.Time(d).Format(time.RFC3339) }

// On Aliased — illegal:
// func (a Aliased) Tag() string { return time.Time(a).Format(time.RFC3339) }
//   ^ cannot define new methods on non-local type time.Time
```

`Aliased` is not "Aliased declared in package demo" — it is `time.Time`, period. The method declaration is treated exactly as if it were `func (a time.Time) Tag()`.

---

## 5. Sanctioned Workarounds

There are exactly three workarounds permitted by the spec.

### Workaround 1 — Defined Wrapper Type

```go
type MyTime time.Time

func (m MyTime) FormatRFC() string {
    return time.Time(m).Format(time.RFC3339)
}
```

- Receiver `MyTime` is defined in this package — legal.
- New methods do not pollute `time.Time`.
- Conversion required: `MyTime(t)` and `time.Time(mt)`.

### Workaround 2 — Free Function

```go
func FormatRFC(t time.Time) string {
    return t.Format(time.RFC3339)
}
```

- No type involved, no method-set surgery.
- Cannot be called as `t.FormatRFC()` — must be `FormatRFC(t)`.
- Cannot satisfy an interface that requires the form `value.Method()`.

### Workaround 3 — Struct Embedding

```go
type Event struct {
    time.Time
    Source string
}

func (e Event) Stamp() string {
    return e.Source + "@" + e.Format(time.RFC3339)
}
```

- `Event` is defined in this package — methods are legal on it.
- Methods of `time.Time` are **promoted** to `Event` per §Selectors.
- New methods on `Event` coexist with promoted methods.

### What is NOT a workaround

```go
// Type alias — same identity as time.Time, no new methods
type X = time.Time

// Generic alias (Go 1.24+) — still an alias
type Y[T any] = []T

// Foreign-type method declaration — outright forbidden
// func (t time.Time) FormatRFC() string { ... }
```

Each of the above produces a compile error or a tautology that adds nothing.

---

## 6. Behavioral Specification

### Conversion between defined wrapper and underlying type

Per §Conversions, a conversion between a defined type and its underlying type is always allowed:

```go
type MyTime time.Time

t  := time.Now()
mt := MyTime(t)              // time.Time -> MyTime
back := time.Time(mt)        // MyTime    -> time.Time
```

The runtime representation is identical; the conversion is a compile-time identity transform.

### Method dispatch on a wrapper does not see the underlying type's methods

Per §Method_sets, the method set of `MyTime` is built from declarations in package containing `MyTime`. None of `time.Time`'s methods belong to `MyTime`:

```go
mt := MyTime(time.Now())
// mt.Format(time.RFC3339)         // compile error — MyTime has no Format
time.Time(mt).Format(time.RFC3339) // OK
```

### Method promotion via embedding

Per §Selectors:

> A selector f may denote a field or method f of type T, or it may refer to a
> field or method f of a nested embedded field of T.

```go
type Event struct{ time.Time }
e := Event{time.Now()}
e.Format(time.RFC3339)   // resolves to Event.Time.Format via promotion
```

The promoted method has the embedded value as its receiver — the call is equivalent to `e.Time.Format(time.RFC3339)`.

### Promoted method set composition

If `S` embeds `T`:

| Method on T | Visible as method on S? |
|-------------|-------------------------|
| `func (t T) M()`  | Yes — value receiver promoted |
| `func (t *T) M()` | Visible on `*S` only (and on `S` only if S is addressable, then `(&s).M()`) |

For `*T` embedded in `S`:
- Both value- and pointer-receiver methods of `T` are promoted to both `S` and `*S`.

### Interface satisfaction

A wrapper type `type W T` satisfies an interface `I` if and only if all methods required by `I` are declared on `W` (or `*W`). The methods of `T` do not contribute, since `W` is a different type.

A struct type `type S struct { T }` satisfies `I` if the union of `S`'s declared methods and `T`'s promoted methods covers `I`.

---

## 7. Method Sets Across Wrappers and Embedding

### Defined wrapper

```go
type MyTime time.Time
func (m MyTime) Tag() string { return "tag" }
```

- Method set of `MyTime`:  `{ Tag }`.
- Method set of `*MyTime`: `{ Tag }` (and any `*MyTime`-receiver methods).

`time.Time.Format` is **not** in either set.

### Struct embedding (value)

```go
type Event struct{ time.Time }
```

Method set of `Event` includes every method declared on `time.Time` with a value receiver. Since `time.Time` methods are mostly value-receiver, almost all are promoted.

Method set of `*Event` additionally includes every `*time.Time`-receiver method (e.g. `UnmarshalJSON`).

### Struct embedding (pointer)

```go
type Conn struct{ *net.TCPConn }
```

Method set of `Conn` includes every method declared on both `net.TCPConn` and `*net.TCPConn`, because the embedded field is a pointer.

### Method shadowing

If a method `M` exists on both the outer type and the embedded type, the outer wins at the outer-type call site:

```go
type Event struct{ time.Time }
func (e Event) String() string { return "Event" }

e := Event{time.Now()}
fmt.Println(e.String())          // "Event" — outer
fmt.Println(e.Time.String())     // "<timestamp>" — inner
```

This is by §Selectors: the shallower depth wins; methods declared directly on `Event` are at depth 0, promoted methods at depth 1+.

---

## 8. Edge Cases from Spec

### Edge Case 1 — Wrapping a type that is itself a wrapper

```go
type A time.Time
type B A          // B's underlying type is time.Time
```

Methods can be declared on `B`. `B`'s method set is independent of `A`'s. Conversions: `A(t)`, `B(a)`, `time.Time(b)`.

### Edge Case 2 — Embedding a type alias

```go
type T = time.Time
type Event struct{ T }   // identical to: struct{ time.Time }
```

Allowed. The field name is the unqualified alias identifier `T`, but selectors still use `Event.T.Method`. Promoted methods come from `time.Time`.

### Edge Case 3 — Embedding a defined wrapper

```go
type MyTime time.Time
type Event struct{ MyTime }   // promotes MyTime's method set, not time.Time's
```

Only methods declared on `MyTime` (or `*MyTime`) are promoted. `time.Time.Format` is **not** available on `Event` because it is not in `MyTime`'s method set.

### Edge Case 4 — Generic alias (Go 1.24+)

```go
type Pair[T any] = struct{ Left, Right T }   // alias with parameters

// func (p Pair[T]) Swap() Pair[T] { ... }    // compile error — alias
```

The alias has no defining package of its own. Methods must be declared on a defined type:

```go
type Pair[T any] struct{ Left, Right T }
func (p Pair[T]) Swap() Pair[T] { return Pair[T]{p.Right, p.Left} }
```

### Edge Case 5 — Receiver parameter clause naming

```go
type T int
func (T)   A() {}     // unnamed receiver — valid
func (_ T) B() {}     // blank receiver — valid
func (t T) C() {}     // named receiver — valid
```

Inside `A` and `B` the receiver value cannot be referenced; only the method's own type association matters.

### Edge Case 6 — Method declaration and import cycles

A wrapper that lives in package `domain` and imports the original type from `time` does not create a cycle. But circular wrappers across packages can create import cycles — the spec does not solve them; restructuring is required.

### Edge Case 7 — Duplicate methods on different wrappers

```go
package a
type X time.Time
func (x X) Format() string { return "a" }

package b
type X time.Time
func (x X) Format() string { return "b" }
```

Both are legal. They are different types (`a.X` vs `b.X`). Conversion between them requires going through `time.Time`.

### Edge Case 8 — Methods on slice/map/function aliases

```go
package mypkg
type StringSet = map[string]struct{}    // alias

// func (s StringSet) Add(k string) { s[k] = struct{}{} }   // compile error
```

The alias is `map[string]struct{}`, an unnamed type. Methods cannot exist on unnamed types per Rule 1.

The fix is a defined type:

```go
type StringSet map[string]struct{}
func (s StringSet) Add(k string) { s[k] = struct{}{} }      // legal
```

---

## 9. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Method declarations and same-package rule defined. |
| Go 1.0 | Defined types and type definitions established. |
| Go 1.9 | Type aliases (`type X = Y`) introduced. Added explicit clarification: aliases share method sets with the aliased type and cannot receive new methods unless defined in the same package as the underlying type. |
| Go 1.18 | Generics introduced. Defined parametric types may have methods (with receiver type parameters re-declared). Methods cannot have their own type parameters. |
| Go 1.21 | No change to cross-package method rules. |
| Go 1.22 | No change to cross-package method rules. |
| Go 1.24 | Generic type aliases (`type X[T any] = Y[T]`) introduced. Same restriction: methods cannot be declared on aliases. |

---

## 10. Spec Compliance Checklist

- [ ] Receiver base type is a defined type (not an alias, not a built-in unnamed type, not a pointer or interface).
- [ ] Receiver base type is in the same package as the method declaration.
- [ ] Foreign types (`time.Time`, `net.IP`, third-party structs) are not used directly as receiver types.
- [ ] Type aliases are not used in attempts to attach methods to foreign types.
- [ ] Generic type aliases (Go 1.24+) are recognized as aliases and treated like non-generic aliases for method-declaration purposes.
- [ ] Defined wrappers convert explicitly (`MyT(x)` and `T(my)`), not implicitly.
- [ ] Embedding is used only when the original method set is desired alongside new methods.
- [ ] Promoted method shadowing is intentional and documented.
- [ ] Wrapper types that need to satisfy stdlib interfaces (`json.Marshaler`, `sql.Scanner`) declare those methods explicitly.
- [ ] No method declaration repeats the foreign type's qualified name as the receiver (`time.Time` is not a valid `BaseTypeName`).

---

## 11. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Method declarations | https://go.dev/ref/spec#Method_declarations | Same-package rule, receiver base type |
| Type definitions | https://go.dev/ref/spec#Type_definitions | Defined types create new identity |
| Alias declarations | https://go.dev/ref/spec#Alias_declarations | Aliases share identity, share package |
| Type identity | https://go.dev/ref/spec#Type_identity | Why defined types are distinct |
| Method sets | https://go.dev/ref/spec#Method_sets | Method set composition |
| Selectors | https://go.dev/ref/spec#Selectors | Method promotion through embedding |
| Conversions | https://go.dev/ref/spec#Conversions | Wrapper <-> underlying type conversions |
| Struct types | https://go.dev/ref/spec#Struct_types | Embedded fields |
| Interface types | https://go.dev/ref/spec#Interface_types | Interface satisfaction via method set |
| Type parameters | https://go.dev/ref/spec#Type_parameters | Methods on generic types |
