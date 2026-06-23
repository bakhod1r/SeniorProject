# Methods on Generic Types — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [Method declarations — the relevant grammar](#method-declarations-the-relevant-grammar)
3. [Receivers on parameterised types](#receivers-on-parameterised-types)
4. [The "identical type parameter list" rule](#the-identical-type-parameter-list-rule)
5. [The forbidden constructs](#the-forbidden-constructs)
6. [Method sets — formal definition](#method-sets-formal-definition)
7. [Method values and method expressions](#method-values-and-method-expressions)
8. [Embedded fields and promoted methods](#embedded-fields-and-promoted-methods)
9. [Type aliases and methods (1.24+)](#type-aliases-and-methods-124)
10. [Summary](#summary)

---

## Source of truth

The authoritative source is the **Go Programming Language Specification**:

- <https://go.dev/ref/spec> — the live spec
- <https://go.dev/ref/spec#Method_declarations> — method declarations
- <https://go.dev/ref/spec#Method_sets> — method sets
- <https://go.dev/ref/spec#Method_values> — method values
- <https://go.dev/ref/spec#Method_expressions> — method expressions

This document quotes and paraphrases the relevant sections. Consult the official spec for canonical wording.

---

## Method declarations — the relevant grammar

The EBNF for a method declaration:

```ebnf
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = Parameters .
```

The receiver is a single-element parameter list. For non-generic types, it is `(name TypeName)`. For generic types, the receiver type names the parameterised type **with its type parameter list**:

```go
func (r ReceiverName ReceiverType[TypeParameters]) MethodName(...) ...
```

Concrete:

```go
type Stack[T any] struct{ data []T }

func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
//        ↑↑↑↑↑↑↑↑
//        receiver type with type parameter list
```

### What the spec says

From the spec:

> A method is a function with a receiver. A method declaration binds an identifier, the method name, to a method, and associates the method with the receiver's base type.

For a generic receiver type, the spec adds:

> If the base type is a parameterized type, the receiver type must specify type parameter names corresponding to the type parameters of the base type.

That is the "must repeat the parameters" rule, formalised.

---

## Receivers on parameterised types

The receiver may be:

- A value type: `(s Stack[T])`
- A pointer type: `(s *Stack[T])`

Both follow the same rules as non-generic Go.

### The receiver name

The receiver name is **arbitrary**:

```go
func (s *Stack[T]) Push(v T) { ... }
func (this *Stack[T]) Push(v T) { ... }   // legal
func (_ *Stack[T]) Push(v T) { ... }       // legal
```

Idiomatic Go uses a short name (one or two letters) drawn from the type.

### The type parameter names

The type parameter names in the receiver are **also arbitrary** as long as the **arity** matches:

```go
type Pair[K, V any] struct{ K, V }

func (p Pair[K, V]) Swap() Pair[V, K] { ... }   // idiomatic
func (p Pair[A, B]) Swap() Pair[B, A] { ... }   // legal — A and B rebind
```

The spec calls this rebinding because the parameter names in the receiver shadow the type's. Inside the method, `A` and `B` are the type parameters; outside, they are still `K` and `V`. **Don't rename**; it confuses readers.

### Constraints come from the type, not the receiver

The receiver's parameter list **does not specify constraints** — the constraint is fixed at the type declaration:

```go
type Counter[T ~int | ~int64] struct{ n T }

// receiver: just [T], not [T ~int | ~int64]
func (c *Counter[T]) Add(d T) { c.n += d }
```

Writing `(c *Counter[T ~int | ~int64])` is a syntax error — receivers cannot redeclare constraints.

---

## The "identical type parameter list" rule

The spec phrases this rule in section *Method declarations*:

> The receiver type ... must specify type parameter names corresponding to the type parameters of the base type. The names need not match those used in the type declaration, but the **count of type parameters must be identical**.

Three implications:

1. **Count must match.** A `Stack[T]` cannot have a method declared on `Stack[T, U]`.
2. **Order matters.** Renaming is fine, reordering is fine if the receiver's positional roles match the type's.
3. **You cannot specialise.** A method on `Stack[int]` is not allowed if `Stack` is generic.

### Specialisation — explicitly forbidden

```go
type Stack[T any] struct{ data []T }

// ❌ specialisation not allowed
func (s *Stack[int]) SumInts() int { ... }
```

The spec rejects this with: *"the receiver's type parameter list must declare names, not specific types"*.

### Workaround — free function

```go
func SumInts(s *Stack[int]) int {
    total := 0
    for _, v := range s.data { total += v }
    return total
}
```

---

## The forbidden constructs

The spec explicitly forbids several constructs around generic-type methods.

### 1. Method-level type parameters

```go
func (s *Stack[T]) Map[U any](f func(T) U) *Stack[U] { ... }   // ❌
```

The spec: *"A method's type parameter list, if present, is identical to the type parameter list of its receiver base type. A method may not declare its own type parameters in addition to those of its receiver."*

### 2. Receiver of an interface type

```go
type I interface { Foo() }

func (i I) Bar() { ... }   // ❌ — interfaces cannot have methods declared
```

You can declare methods only on **defined types** that are not interfaces — generics do not change this.

### 3. Receiver of an unnamed type

```go
func (m map[string]int) Foo() { ... }   // ❌
```

Methods can be declared only on a defined (named) type. Generic instantiations of a named type are still considered the named type.

### 4. Receiver of an alias to a generic type (pre-1.24)

```go
type IntStack = Stack[int]

func (s *IntStack) Foo() { ... }   // ❌ in Go before 1.24
```

Pre-1.24, methods belong to the underlying type, not the alias. From 1.24 the rule remains: methods are tied to the original generic-type definition.

### 5. Two methods with the same name on the same type

Same as classic Go — duplicates are forbidden.

---

## Method sets — formal definition

The spec defines method sets in section *Method sets*:

> The method set of a type determines the interfaces that the type implements and the methods that can be called using a receiver of that type.

For a generic type:

> The method set of type T consists of all methods declared with receiver type T. The method set of a pointer to a defined type T (where T is neither a pointer nor an interface) is the set of all methods declared with receiver *T or T.

For instantiated generic types:

> Methods declared on a generic type T[P...] are inherited by every instantiation T[A...] with the type parameters substituted accordingly.

Example:

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T)       {}
func (s *Stack[T]) Pop() (T, bool) {}
func (s Stack[T]) Len() int        {}

// Method sets after Stack[int]:
//   Stack[int]:  { Len() int }
//   *Stack[int]: { Push(int), Pop() (int, bool), Len() int }
```

The substitution `T → int` happens uniformly across the method set.

### Method set determines interface satisfaction

For an interface `I`:

> A type T implements an interface if its method set is a superset of the interface's method set.

Therefore `*Stack[int]` implements `interface { Push(int) }`, but `*Stack[string]` does not — different signatures after substitution.

---

## Method values and method expressions

The spec defines two related forms.

### Method values

> A method expression yields a function whose first argument is the receiver. A method value is a function value bound to a specific receiver.

For generics:

```go
s := &Stack[int]{}
push := s.Push       // method value, type: func(int)
```

The spec: *"For a method value `x.M`, the receiver `x` is captured at the time of evaluation."* The type parameter is also fixed at that time.

### Method expressions

> A method expression yields a function value taking the receiver as its first argument.

For generics:

```go
push := (*Stack[int]).Push      // method expression, type: func(*Stack[int], int)
```

The instantiation `Stack[int]` must be **explicit** in a method expression — the compiler cannot infer it.

### Type of method values and expressions

The type of a method value is the method's signature with the receiver removed and type parameters substituted. For `(s *Stack[T]) Push(v T)` instantiated for `int`:

- Method value `s.Push`: `func(int)`
- Method expression `(*Stack[int]).Push`: `func(*Stack[int], int)`

These are **regular function types** — they carry no generic-ness.

---

## Embedded fields and promoted methods

The spec on embedded fields and method promotion:

> A field or method `f` of an embedded field in a struct `x` is called *promoted* if `x.f` is a legal selector that denotes that field or method.

For generic embedding:

```go
type Inner[T any] struct{}
func (Inner[T]) M() { fmt.Println("inner") }

type Outer[T any] struct{ Inner[T] }   // embed
```

Method `M` is promoted to `Outer[T]`. `Outer[int]{}.M()` prints `inner`.

### The substitution rule

When `Outer[int]` embeds `Inner[T]`, the embedded type becomes `Inner[int]` — the outer's `T` substitutes the inner's `T`. The promoted method's signature is therefore `M()` — no `T` left.

### Method ambiguity

> If two embedded fields provide methods with the same name, neither is promoted.

This applies identically to generic embeds.

---

## Type aliases and methods (1.24+)

Pre-Go 1.24, type aliases could not be parameterised. From Go 1.24:

```go
type List[T any] = []T   // 1.24+ generic alias
```

The spec adds:

> Methods may not be declared on type aliases. They must be declared on the original type definition.

So even with generic aliases, methods belong to the underlying type:

```go
type Stack[T any] struct{ data []T }
type StackAlias[T any] = Stack[T]    // 1.24+

// methods are on Stack[T], not StackAlias[T]
func (s *Stack[T]) Push(v T) { ... }
```

The alias is convenient for callers but does not introduce new methods.

---

## Summary

The Go specification handles methods on generic types with surprising precision:

1. **Method declarations** require the receiver to repeat the type's type parameter list.
2. **The arity must match exactly** — count and shape, not constraints.
3. **Type parameter names in the receiver may be renamed** but should not be.
4. **Method-level type parameters are forbidden** — the spec is explicit.
5. **Method sets** are computed by substituting type arguments into the receiver's parameters.
6. **Interface satisfaction** is checked per instantiation.
7. **Method values and expressions** behave like classic Go, with the type parameter resolved at binding time.
8. **Type aliases (1.24+)** can be parameterised but do not host methods.

The spec is short on this topic precisely because the grammar is small. Most "rules" you encounter are corollaries of one fact: **the receiver's parameter list mirrors the type's**. Internalise that and the rest follows.

Next: `interview.md` to drill these rules in question form.
