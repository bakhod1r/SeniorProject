# error interface — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The Predeclared error Interface](#the-predeclared-error-interface)
3. [Spec Text on Interface Types](#spec-text-on-interface-types)
4. [Method Sets — Spec Rules](#method-sets-spec-rules)
5. [Pointer vs Value Receivers in the Spec](#pointer-vs-value-receivers-in-the-spec)
6. [Interface Satisfaction](#interface-satisfaction)
7. [Conversion to Interface Type](#conversion-to-interface-type)
8. [Interface Identity and Equality](#interface-identity-and-equality)
9. [Comparable Constraints on Dynamic Types](#comparable-constraints-on-dynamic-types)
10. [Embedding and the Method Set](#embedding-and-the-method-set)
11. [Type Assertions and Type Switches](#type-assertions-and-type-switches)
12. [What the Spec Says About error Specifically](#what-the-spec-says-about-error-specifically)
13. [Things the Spec Does NOT Say](#things-the-spec-does-not-say)
14. [References](#references)

---

## Introduction

The `error` interface is one method (`Error() string`) layered on top of Go's general interface machinery. The `errors` package and idioms around custom error types are convention; the satisfaction rules, method-set arithmetic, and conversion semantics are spec.

This file gathers the relevant spec text — about interface types, method sets, and conversions — and applies it to error types. Reference: [The Go Programming Language Specification](https://go.dev/ref/spec).

---

## The Predeclared error Interface

From **Predeclared identifiers**:

> Types: any, bool, byte, comparable, complex64, complex128, error, float32, float64, int, ..., uintptr

`error` is a predeclared *interface type* in the universe block. Conceptually:

```go
type error interface {
    Error() string
}
```

Predeclared status implies:

- It is in scope everywhere; you do not import it.
- It cannot be redefined at package scope.
- It can be shadowed in a smaller scope (do not).
- It is part of the language, so a program with no imports can still declare and return errors.

The spec does not mandate any other methods on error types. `Unwrap`, `Is`, and `As` are conventions implemented as optional methods recognized by the `errors` package.

---

## Spec Text on Interface Types

From **Interface types**:

> An interface type defines a *type set*. A variable of interface type can store a value of any type that is in the type set of the interface.

> A type T satisfies an interface I if T is an element of the type set of I.

> The interface type that has no methods is called the *empty interface*.

The error interface has exactly one method specification:

```
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
MethodElem     = MethodName Signature .
MethodName     = identifier .
```

Applied to `error`, the method element is `Error() string`.

---

## Method Sets — Spec Rules

From **Method sets**:

> The method set of a defined type T consists of all methods declared with receiver type T.
>
> The method set of a pointer type *T (where T is not a pointer or interface) consists of all methods declared with receiver *T or T.
>
> The method set of an interface type is its type set.

Translated for error types:

| Concrete type | Method set includes |
|---------------|---------------------|
| `T` (non-interface, non-pointer) | methods declared on `T` |
| `*T` | methods declared on `T` *and* on `*T` |
| `I` (interface) | the interface's own methods |

So if you write:

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "x" }
```

Only `*MyErr` has `Error()` in its method set. `MyErr` does not. Therefore `MyErr` does not satisfy `error`; `*MyErr` does.

Conversely:

```go
type MyErr struct{}
func (e MyErr) Error() string { return "x" }
```

Now the method is on the value receiver. Both `MyErr` and `*MyErr` carry `Error()` in their method sets, and both satisfy `error`.

This asymmetry is the source of many "my struct doesn't satisfy error!" surprises.

---

## Pointer vs Value Receivers in the Spec

From **Method declarations**:

> The receiver is specified via an extra parameter section preceding the method name in the function declaration. ... The receiver type must be of the form T or *T (possibly using parentheses) where T is a type name.

The spec is silent on *which* to choose. It only says:

- `func (e T) M()` — value receiver. Method receives a copy.
- `func (e *T) M()` — pointer receiver. Method receives the address.

For error types the spec does not require either. The community convention is pointer for error types with fields; value for empty types or named string types.

The spec also specifies that the same type **must not mix** value and pointer receivers in some scenarios (vet warns; runtime allows it but it is a smell). For an `error`, pick one consistently.

---

## Interface Satisfaction

From **Implementing an interface**:

> A type T implements an interface I if its method set is a superset of the methods listed in I, where method names match exactly and signatures match exactly.

Applied to `error`:

```go
type implementsError interface {
    Error() string
}
```

Any T with method `Error() string` (exactly that signature) implements `error`. Variations that do *not* satisfy:

- `Errorr() string` — typo. No match.
- `Error() (string, error)` — signature mismatch.
- `Error() string` declared on `*T` while you assign a value of type `T` — method set of `T` does not contain it.
- Method on pointer receiver, value passed — same as above.

The compiler enforces this at the assignment point. Errors look like:

```
cannot use v (variable of type Foo) as type error in return argument:
    Foo does not implement error (Error method has pointer receiver)
```

---

## Conversion to Interface Type

From **Assignability** and **Conversions**:

> A value x of type V is assignable to a variable of type T if V and T have identical underlying types, or T is an interface type and V implements T.

So when you write:

```go
var err error = &MyErr{}
```

The conversion happens implicitly at assignment. The compiler:

1. Verifies `*MyErr` satisfies `error` (its method set contains `Error() string`).
2. Builds an interface value with two words: type info (the itab) and a data pointer.

The spec does not specify the layout, but it specifies the semantics: after the conversion, the interface value's *dynamic type* is `*MyErr` and *dynamic value* is the pointer.

---

## Interface Identity and Equality

From **Comparison operators**:

> Interface values are comparable. Two interface values are equal if they have identical dynamic types and equal dynamic values, or if both have value nil.

Three cases for `var a, b error`:

- Both nil: equal.
- Same dynamic type, equal dynamic value: equal.
- Different dynamic types: not equal (regardless of values).
- One nil, the other non-nil: not equal.

The "typed-nil interface" gotcha follows directly:

```go
var p *MyErr = nil
var e error = p
// e.dynamic_type = *MyErr  (non-nil)
// e.dynamic_value = nil
// e == nil   ->   FALSE  (only one of the two is nil)
```

Per spec, equality requires *both* the type word and the value word to be nil. If you funnel a typed nil pointer through the interface, the type word is set and the comparison fails.

---

## Comparable Constraints on Dynamic Types

From **Comparison operators**:

> A comparison of two interface values with identical dynamic types causes a run-time panic if that type is not comparable.

Applied to errors: if your error type contains a slice, a map, or a function, its values are not comparable. Two interface values both wrapping such a type will *panic* at the `==` comparison:

```go
type BadErr struct{ Tags []string }
func (BadErr) Error() string { return "bad" }

var a error = BadErr{Tags: []string{"x"}}
var b error = BadErr{Tags: []string{"x"}}
_ = a == b  // panic: comparing uncomparable type main.BadErr
```

`errors.Is` does this comparison internally; therefore it panics on non-comparable error types. The fix is either a pointer receiver (pointers are comparable) or removing non-comparable fields.

The standard library's error types are all comparable — they use only strings, ints, named types, and other interface values.

---

## Embedding and the Method Set

From **Struct types** and **Selectors**:

> A field declared with a type but no explicit field name is called an *embedded field*. ... Promoted fields act like ordinary fields of a struct except that they cannot be used as field names in composite literals.

> The method set of a type consisting of an embedded field T includes all methods of T (and *T if applicable), promoted to the outer type.

So embedding `error`:

```go
type ValidationError struct {
    error
    Field string
}
```

The outer struct's method set inherits `Error() string` from the embedded `error` interface. `ValidationError` therefore satisfies `error` with no explicit method declaration.

Promotion has limits:

- Methods are promoted; fields are too.
- Name conflicts at the same depth produce ambiguity errors.
- Embedding does *not* automatically promote methods recognized by `errors.Is`/`errors.As` (`Unwrap`, `Is`, `As`) — these are not part of the spec; they are conventional methods. If the embedded type has them, they are promoted *if and only if* the spec rules for method promotion apply (depth, conflict-free, etc.).

---

## Type Assertions and Type Switches

From **Type assertions**:

> For an expression x of interface type, but not a type parameter, and a type T, the primary expression x.(T) asserts that x is not nil and that the value stored in x is of type T.

Applied to errors:

```go
err := someFunc()
if pe, ok := err.(*os.PathError); ok {
    // pe is *os.PathError
}
```

The two-result form is non-panicking. The single-result form panics if the assertion fails.

Type switch:

```go
switch e := err.(type) {
case *os.PathError:
    // ...
case *json.SyntaxError:
    // ...
case error:
    // ...
}
```

The cases must each be a type expression. `case error` matches any error (since the dynamic value satisfies `error` by virtue of being in the variable). `case nil` matches the nil interface value.

---

## What the Spec Says About error Specifically

The spec mentions `error` in only a handful of places:

- **Predeclared identifiers**: `error` is a predeclared type.
- **Type assertions / type switches**: example uses include `e.(error)` and `case error:`.
- **Built-in functions** (`panic`/`recover`): the parameter and return are `interface{}` (now `any`), not `error`. Errors and panics are independent mechanisms in the spec.

The semantics — when to use it, how to wrap it, how to compare it — are convention layered on top of:

- The interface satisfaction rules.
- The method set rules.
- The interface equality rules.

---

## Things the Spec Does NOT Say

- **Pointer vs value receiver**: the spec is neutral. Convention prefers pointers for error structs.
- **Naming the method**: `Error()` is required by the predeclared interface, but the spec does not say "every error must spell it `Error`." It says: the method set must contain `Error() string` to satisfy `error`.
- **Wrapping behavior**: `Unwrap`, `Is`, `As` are not in the spec. They are package-level conventions.
- **Sentinels**: package-level `var ErrFoo = errors.New(...)` is convention. The spec only knows about variable declarations.
- **Behavioral interfaces** (Temporary, Timeout): not in spec. Convention from `net`.
- **Embedding the error interface**: legal under struct embedding rules; the spec does not single out errors.

The spec gives you the *rules*; the community gives you the *patterns*. Both layers matter.

---

## References

- [The Go Programming Language Specification — Predeclared identifiers](https://go.dev/ref/spec#Predeclared_identifiers)
- [The Go Programming Language Specification — Interface types](https://go.dev/ref/spec#Interface_types)
- [The Go Programming Language Specification — Method sets](https://go.dev/ref/spec#Method_sets)
- [The Go Programming Language Specification — Method declarations](https://go.dev/ref/spec#Method_declarations)
- [The Go Programming Language Specification — Comparison operators](https://go.dev/ref/spec#Comparison_operators)
- [The Go Programming Language Specification — Type assertions](https://go.dev/ref/spec#Type_assertions)
- [The Go Programming Language Specification — Struct types](https://go.dev/ref/spec#Struct_types)
- `$GOROOT/src/builtin/builtin.go` — declared `error` interface for documentation.
- `$GOROOT/src/runtime/iface.go` — runtime implementation of interface dispatch.
