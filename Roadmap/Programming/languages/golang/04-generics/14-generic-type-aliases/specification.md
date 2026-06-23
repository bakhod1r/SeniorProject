# Generic Type Aliases — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [The 1.24 release-notes excerpt](#the-124-release-notes-excerpt)
3. [Spec section: Alias declarations](#spec-section-alias-declarations)
4. [The grammar update](#the-grammar-update)
5. [Type identity rules](#type-identity-rules)
6. [Method declarations and aliases](#method-declarations-and-aliases)
7. [Constraints on alias parameters](#constraints-on-alias-parameters)
8. [Instantiation of generic aliases](#instantiation-of-generic-aliases)
9. [Predeclared aliases](#predeclared-aliases)
10. [The `GOEXPERIMENT=aliastypeparams` window](#the-goexperimentaliastypeparams-window)
11. [What the spec still forbids](#what-the-spec-still-forbids)
12. [Summary](#summary)

---

## Source of truth

The authoritative sources are:

- <https://go.dev/ref/spec> — the live language specification
- <https://go.dev/ref/spec#Alias_declarations> — Alias declarations section, updated for 1.24
- <https://go.dev/ref/spec#Type_parameters> — type parameters
- <https://go.dev/doc/go1.24> — the 1.24 release notes
- The accepted issue: <https://github.com/golang/go/issues/46477>

This document quotes and explains the relevant excerpts. Quotations are paraphrased for clarity; consult the official spec for canonical wording.

---

## The 1.24 release-notes excerpt

The release notes for Go 1.24 say (paraphrased):

> Type aliases may now have type parameters. The form
>
> ```go
> type A[P C] = B
> ```
>
> declares `A` as a parameterized alias for the type `B`, where `P` is a type parameter of `A` and `C` is its constraint. Within the right-hand side `B`, the parameter `P` may be referenced.

The release notes call out three practical points:

1. The feature was previously gated by `GOEXPERIMENT=aliastypeparams`; in 1.24 it is **enabled by default**.
2. The change is backwards compatible — code that did not use parameterised aliases is unaffected.
3. The intended use case is **re-exporting generic types** across package boundaries.

There is no runtime impact. The compiler resolves the alias at compile time.

---

## Spec section: Alias declarations

The spec defines an alias declaration as:

> An alias declaration binds an identifier to the given type.

The 1.24 spec extends this with:

> Within a parameterized alias declaration the alias name is followed by a list of type parameters, each of which may be used in the aliased type.

Concrete:

```go
type Vec[T any] = []T
//   ^   ^^^^^   ^^^
//   |   params  aliased type using T
//   alias name
```

The text also clarifies:

- The aliased type may itself be a generic type instantiation, as long as the type arguments are valid.
- The alias name is in scope inside its own declaration only on the right-hand side.

---

## The grammar update

Pre-1.24 grammar:

```ebnf
AliasDecl = identifier "=" Type .
```

Post-1.24 grammar:

```ebnf
AliasDecl = identifier [ TypeParameters ] "=" Type .
```

`TypeParameters` reuses the same production used for parameterised functions and parameterised type definitions:

```ebnf
TypeParameters  = "[" TypeParamList [ "," ] "]" .
TypeParamList   = TypeParamDecl { "," TypeParamDecl } .
TypeParamDecl   = IdentifierList TypeConstraint .
```

So a generic alias is grammatically just `identifier [ TypeParameters ] "=" Type`. No new tokens, no new keywords.

### Examples that are now legal

```go
type Vec[T any] = []T
type Map[K comparable, V any] = map[K]V
type Result[T any] = otherpkg.Result[T]
type Pair[A, B any] = struct{ First A; Second B }
```

### Examples that remain illegal

```go
type Vec[T any] []T // legal — defined type, not alias

// methods on alias — still forbidden
type Vec[T any] = []T
func (v Vec[T]) Len() int { return len(v) } // ERROR: cannot define methods on non-local type

// constraint cycle — still forbidden
type C[T C[T]] = T // self-referential — rejected
```

---

## Type identity rules

The spec on type identity:

> Two types are identical if they have the same name and the same underlying type. The name of an alias is the name of the aliased type for purposes of identity.

That is the precise wording that makes `Vec[int]` identical to `[]int`. The alias name **does not** create a new identity; it is collapsed to the aliased type during type checking.

Practical consequences:

- `Vec[int]` is assignable to `[]int` and vice versa.
- A type switch case `case Vec[int]` is the **same** case as `case []int`. You cannot have both.
- `reflect.TypeOf(v)` returns the underlying type's descriptor.

The spec contrasts this with type definitions:

> A type definition creates a new, distinct type with the same underlying type and operations as the given type, and binds an identifier to it.

So `type Vec[T any] []T` creates a distinct type, while `type Vec[T any] = []T` does not.

---

## Method declarations and aliases

The spec restriction has been in place since 1.9:

> Methods may not be declared on a type that is defined in another package, even if that type is named locally via an alias.

This applies regardless of whether the alias is generic. The compiler error is:

```
cannot define new methods on non-local type X
```

Why?

- The alias does not introduce a local type.
- Methods must be declared in the package that owns the type.
- An alias in package `mypkg` referring to `bar.X` would, if methods were allowed, let `mypkg` extend `bar`'s method set — violating the package boundary.

This rule is the single most important constraint on alias usage. If you need to declare methods, you need a defined type.

---

## Constraints on alias parameters

The spec requires alias parameter constraints to be compatible with the constraints of the aliased type:

> The constraint of each type parameter of an alias must be such that the aliased type is well-formed for every valid type argument.

In practice:

```go
package bar
type Set[T comparable] = map[T]struct{}

package mypkg
import "example.com/bar"

// OK — constraint matches
type Set[T comparable] = bar.Set[T]

// ERROR — T does not satisfy comparable
type LooseSet[T any] = bar.Set[T]
```

The compiler checks that for any valid `T` in the alias's constraint, the right-hand side type is well-formed. Loosening the constraint is rejected.

---

## Instantiation of generic aliases

When a generic alias is **instantiated**, the type parameter is substituted into the right-hand side. The spec:

> Instantiation of a generic alias replaces each type parameter with the corresponding type argument throughout the aliased type.

```go
type Vec[T any] = []T

// Instantiation
var v Vec[int] // equivalent to []int

// Also legal: explicit
type IntVec = Vec[int] // equivalent to []int
```

The result of instantiation is a regular Go type — there is no separate "alias instance" runtime value.

### Inference

Type inference works the same way as for generic types and functions:

```go
func F[T any](v Vec[T]) { fmt.Println(v) }

F([]int{1, 2}) // T inferred as int
```

The compiler walks the same inference rules; the alias is just textually resolved to its underlying form during the process.

---

## Predeclared aliases

The standard `any` alias predates 1.24:

```go
type any = interface{}
```

This is itself an alias declaration — non-generic. There are no predeclared **generic** aliases as of Go 1.24.

The Go team has discussed whether to add convenience aliases like `type Slice[T] = []T` to the universe block, but the answer so far is **no** — predeclared names are kept minimal.

---

## The `GOEXPERIMENT=aliastypeparams` window

The compiler has the ability to gate language features behind environment-controlled experiments:

```bash
GOEXPERIMENT=aliastypeparams go build ./...
```

For 1.22 and 1.23, this flag enabled the parser and type checker to accept generic aliases. Code outside the experiment was rejected with the historical error "type alias cannot have type parameters".

In 1.24 the experiment was promoted to default. The flag still exists for backward-compatibility scripts but is a no-op:

> The `aliastypeparams` experiment is enabled by default in Go 1.24 and may be removed in a future release.

The spec treats the feature as fully part of the language from 1.24 onward.

---

## What the spec still forbids

Even with parameterised aliases, several constructs remain illegal:

### 1. Methods on aliases

```go
type Vec[T any] = []T
func (v Vec[T]) Len() int { return len(v) } // ERROR
```

Same rule as for non-generic aliases.

### 2. Self-referential alias constraints

```go
type C[T C[T]] = T // ERROR — constraint cycle
```

The constraint cannot reference the alias being declared.

### 3. Aliases as constraint types

```go
type Constraint[T any] = interface{ M() T } // legal as a type
func F[T Constraint[int]](v T) {} // ERROR — alias of interface used as constraint requires care
```

Aliases of interfaces can sometimes be used as constraints, but the spec restricts certain forms (especially around `comparable` and predeclared interfaces). Use a defined interface for constraints to avoid ambiguity.

### 4. Cyclic alias chains that expand infinitely

```go
type A[T any] = B[T]
type B[T any] = A[T] // ERROR — cycle
```

The compiler detects mutual recursion that does not terminate.

### 5. Using an alias's type parameters outside its body

```go
type Vec[T any] = []T

var x T // ERROR — T is not in scope here
```

The parameter is bound only inside the alias declaration's right-hand side.

### 6. Method type parameters (still!)

The 1.24 spec did not change the rule that method declarations cannot introduce their own type parameters. Generic aliases do not affect this.

```go
type Box[T any] struct{ v T }

func (b Box[T]) Map[U any](f func(T) U) Box[U] { ... } // ERROR — still forbidden
```

---

## Summary

The Go specification handles generic aliases with surprising **economy**: a single grammatical change to the alias declaration grammar (`[ TypeParameters ]` between the identifier and `=`). The spec text was updated in three small places:

1. **Alias declarations** — the grammar and identity rule.
2. **Type identity** — clarifies that aliased generic types preserve identity.
3. **Forbidden constructs** — explicitly notes that methods on aliases remain forbidden.

Everything else — type inference, constraint satisfaction, instantiation — works exactly the same as for parameterised type definitions. The feature is intentionally orthogonal: it adds nothing semantically new, only a way to give an existing parameterised type a second name.

Key takeaways:

1. **Generic aliases preserve identity** — `Vec[int]` and `[]int` are the same type.
2. **Methods cannot be attached to aliases** — this rule is unchanged.
3. **Constraints must match** the underlying type's constraints.
4. **Instantiation is a textual substitution** at compile time, with no runtime cost.
5. **`GOEXPERIMENT=aliastypeparams`** was the 1.22 / 1.23 opt-in; 1.24 makes it default.
6. **Self-referential and cyclic aliases** remain forbidden.
7. **Method type parameters** remain forbidden (a separate, longstanding rule).

For day-to-day work, you rarely consult the spec for this feature — but when you do, you now know which sections to read. Next: `interview.md` to drill the design rationale.
