# Generic Type Aliases — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where Generic Type Aliases Are Specified](#where-generic-type-aliases-are-specified)
3. [Grammar: Alias Declarations With Type Parameters](#grammar-alias-declarations-with-type-parameters)
4. [Instantiation and Substitution](#instantiation-and-substitution)
5. [Type Identity (Per Reference)](#type-identity-per-reference)
6. [Constraint Rules (Per Reference)](#constraint-rules-per-reference)
7. [Method Receivers: Why Aliases Are Excluded](#method-receivers-why-aliases-are-excluded)
8. [Alias vs Type Definition (Spec Contrast)](#alias-vs-type-definition-spec-contrast)
9. [Cyclic Alias Restriction](#cyclic-alias-restriction)
10. [Differences Across Go Versions](#differences-across-go-versions)
11. [References](#references)

---

## Introduction

Unlike `go mod vendor` (a tooling feature), generic type aliases **are** part of the language and are specified in the **Go language specification** at `go.dev/ref/spec`. The governing section is **"Alias declarations"**, which in Go 1.24 permits an optional type parameter list on the left of `=`. Supporting rules come from **"Type parameter declarations"**, **"Instantiations"**, **"Type identity"**, **"Satisfying a constraint"**, and **"Method declarations"**.

Sources of truth, in decreasing formality:

1. **Go language specification** — `go.dev/ref/spec`, sections listed above. Authoritative.
2. **Go 1.24 release notes** — `go.dev/doc/go1.24#language`, which announce the feature.
3. **Proposal #46477** — `go.dev/issue/46477`, the design record.
4. **Toolchain / `go/types` source** — the de-facto reference where prose is terse.

This file separates "what the spec states" from convention and implementation detail.

---

## Where Generic Type Aliases Are Specified

The feature is the composition of two existing spec mechanisms:

1. **"Alias declarations"** — defines `type A = T` and, in Go 1.24, `type A[P ...] = T`. An alias declaration binds an identifier to a type; with a type parameter list it binds a *parameterized* name.
2. **"Instantiations"** — defines how a generic type name plus type arguments produces a concrete type by substitution. This section already governed generic functions and generic defined types; it applies to generic aliases unchanged.

Nothing about generic aliases requires new identity or constraint *semantics*; they reuse the rules already in the spec. The only new grammar is the optional `TypeParameters` on an `AliasDecl`.

---

## Grammar: Alias Declarations With Type Parameters

The spec grammar for an alias declaration, as of Go 1.24:

```
AliasDecl = identifier [ TypeParameters ] "=" Type .
```

Where `TypeParameters` is the standard bracketed list shared with function and type-definition declarations:

```
TypeParameters  = "[" TypeParamList [ "," ] "]" .
TypeParamList   = TypeParamDecl { "," TypeParamDecl } .
TypeParamDecl   = IdentifierList TypeConstraint .
```

Examples that parse under this grammar:

```go
type Set[T comparable]      = map[T]struct{}
type Pair[A, B any]         = struct{ First A; Second B }
type Handler[T any]         = func(context.Context, T) error
type Map[K comparable, V any] = map[K]V
```

Constraints:

- The type parameter list is optional. Without it, the declaration is an ordinary (non-generic) alias as in Go 1.9+.
- When present, the alias is *generic* and must be instantiated before use as a type.
- The `Type` on the right of `=` (the RHS) may reference the declared type parameters.

---

## Instantiation and Substitution

Per the spec's **"Instantiations"** section, a generic type is instantiated by substituting type arguments for its type parameters. For a generic alias `type Alias[P ...] = RHS`, the instantiation `Alias[Args]` denotes:

```
subst(RHS, P → Args)
```

Worked examples (the `≡` denotes "denotes / is identical to"):

```
Set[string]            ≡ map[string]struct{}
Pair[int, bool]        ≡ struct{ First int; Second bool }
Map[string, int]       ≡ map[string]int
Handler[Request]       ≡ func(context.Context, Request) error
```

The spec is explicit that instantiation requires each type argument to **satisfy** the corresponding type parameter's constraint (see [Constraint Rules](#constraint-rules-per-reference)). A bare generic alias name used where a type is required, without arguments, is an error — instantiation is mandatory.

Partial specialization through a further alias is permitted, producing a new generic alias with fewer parameters:

```
type StringMap[V any] = Map[string, V]   // one parameter remains
StringMap[int]        ≡ Map[string, int] ≡ map[string]int
```

---

## Type Identity (Per Reference)

The spec's **"Type identity"** section governs when two types are the same. The operative principle for aliases is that **an alias denotes its RHS**; the alias name has no independent identity. Therefore:

- `Alias[Args]` is **identical** to the substituted RHS.
- Two alias instantiations are identical iff their substituted RHS types are identical.
- An alias instantiation is identical to a hand-written type equal to the substituted RHS.

Per the reference, this means:

```go
type Set[T comparable] = map[T]struct{}

var a Set[int]
var b map[int]struct{}
a = b // valid: identical types, no conversion
```

When the RHS is (or contains) a **defined** generic type, identity is the *named-type* identity of that defined type with its arguments — not the structural shape:

```go
type C[K comparable, V any] = pkg.Cache[K, V]
// C[string,int] is identical to pkg.Cache[string,int]
// It is NOT identical to a struct of the same layout, because
// pkg.Cache is a defined type whose identity is by name.
```

This follows directly from the spec: aliases resolve through, defined types stop at their name.

---

## Constraint Rules (Per Reference)

Two spec rules apply.

**1. Constraint satisfaction at instantiation.** Per **"Satisfying a constraint"**, each type argument to `Alias[Args]` must satisfy the corresponding parameter's declared constraint:

```go
type Set[T comparable] = map[T]struct{}
Set[string] // string satisfies comparable — valid
Set[[]int]  // []int does not satisfy comparable — error
```

**2. Well-formedness of the RHS for every instantiation.** The spec requires types to be well-formed. Because the RHS must be valid for *every* satisfying argument, the alias's declared constraints must be at least as strong as the RHS demands. The compiler enforces this at **declaration** time:

```go
type Set[T comparable] = map[T]struct{} // OK: comparable suffices for a map key
type Bad[T any]        = map[T]struct{} // error: any permits non-comparable map keys
```

You may declare a constraint *stronger* than required (narrowing callers); you may not declare a *weaker* one. The reference treats this as an instance of the general rule that a generic type's parameters must guarantee a valid type for all permitted arguments — the same obligation a generic *defined* type carries via its underlying type.

---

## Method Receivers: Why Aliases Are Excluded

The spec's **"Method declarations"** section requires the receiver base type to be a **defined type** declared in the same package (or a pointer to one). An alias is not a defined type; it is a name denoting another type. Consequently, a method cannot be declared with an alias as its receiver:

```go
type Set[T comparable] = map[T]struct{}
func (s Set[T]) Add(v T) {} // illegal: receiver base is not a defined type
```

The spec does not carve out a special case for generic aliases — the general receiver rule already excludes them, because substituting the alias yields a composite type literal (`map[...]...`), which is not a valid receiver base. To declare methods, the program must use a **type definition** (no `=`):

```go
type Set[T comparable] map[T]struct{}          // defined type
func (s Set[T]) Add(v T) { s[v] = struct{}{} }  // valid
```

This is the spec-level reason transparency and methods are mutually exclusive.

---

## Alias vs Type Definition (Spec Contrast)

The spec distinguishes two declarations sharing the `type` keyword:

| | Alias declaration | Type definition |
|--|-------------------|-----------------|
| Syntax | `type A[P ...] = T` | `type A[P ...] T` |
| Creates a new type? | No — denotes `T` | Yes — a new *defined* type |
| Identity with `T` | Identical (after subst.) | Distinct; `T` is the underlying type |
| Methods | Not permitted | Permitted |
| Conversion to/from `T` | Not needed (identical) | Required |
| Spec section | "Alias declarations" | "Type definitions" |

The single token `=` selects between them. Both accept the same `TypeParameters` grammar in Go 1.24.

---

## Cyclic Alias Restriction

The spec forbids an alias whose definition refers to itself such that resolution does not terminate. Because an alias denotes its RHS by substitution, a cycle of aliases never bottoms out:

```go
type A[T any] = B[T]
type B[T any] = A[T] // error: invalid recursive type alias
```

By contrast, a **defined** type may be recursive, because its name provides a finite reference point that breaks the cycle:

```go
type List[T any] struct {
    Head T
    Tail *List[T] // valid: refers to the named type
}
```

The reference treats this as a consequence of the difference between *denoting* (aliases) and *naming* (defined types).

---

## Differences Across Go Versions

The behavior of type aliases has evolved:

- **Go 1.9** — Type aliases introduced: `type A = B`. **No type parameters** (generics did not exist).
- **Go 1.18** — Generics introduced (type parameters on functions and *defined* types). Parameterized aliases were **deliberately deferred** (tracked by proposal #46477).
- **Go 1.23** — *Experimental, partial* support for type parameters on aliases, gated behind `GOEXPERIMENT=aliastypeparams`. Off by default; not covered by the compatibility promise.
- **Go 1.24** — **Full support, enabled by default.** Generic type aliases are standard Go. Announced in the Go 1.24 release notes under language changes. This is the version to target.

The grammar addition (optional `TypeParameters` on `AliasDecl`) is the only language change; identity, constraint, instantiation, and receiver rules were reused unchanged.

A library that uses generic aliases in its public API thereby requires consumers to build with Go 1.24+. Set `go 1.24` (or later) in `go.mod` so the toolchain enforces and diagnoses the minimum cleanly.

---

## References

- [Go language specification](https://go.dev/ref/spec) — authoritative.
- [Spec — Alias declarations](https://go.dev/ref/spec#Alias_declarations) — the parameterized form.
- [Spec — Type definitions](https://go.dev/ref/spec#Type_definitions) — contrast with defined types.
- [Spec — Instantiations](https://go.dev/ref/spec#Instantiations) — substitution rules.
- [Spec — Type identity](https://go.dev/ref/spec#Type_identity) — why `Set[int]` ≡ `map[int]struct{}`.
- [Spec — Satisfying a constraint](https://go.dev/ref/spec#Satisfying_a_constraint) — instantiation constraint checks.
- [Spec — Method declarations](https://go.dev/ref/spec#Method_declarations) — the receiver rule that excludes aliases.
- [Go 1.24 Release Notes — Language](https://go.dev/doc/go1.24#language) — feature announcement.
- [Proposal #46477](https://go.dev/issue/46477) — spec: allow type parameters on type aliases.
