# Generic Type Aliases — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Identity Rule, Precisely](#the-identity-rule-precisely)
3. [Constraint Checking on the Alias](#constraint-checking-on-the-alias)
4. [Why You Cannot Declare Methods on an Alias](#why-you-cannot-declare-methods-on-an-alias)
5. [Partial and Full Instantiation](#partial-and-full-instantiation)
6. [Type Inference and Generic Aliases](#type-inference-and-generic-aliases)
7. [Aliasing Another Generic Alias](#aliasing-another-generic-alias)
8. [Alias vs Defined Generic Type: the Decision](#alias-vs-defined-generic-type-the-decision)
9. [Cyclic and Recursive Alias Errors](#cyclic-and-recursive-alias-errors)
10. [The Version Timeline (1.23 experiment → 1.24 default)](#the-version-timeline-123-experiment--124-default)
11. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
12. [Best Practices for Real Codebases](#best-practices-for-real-codebases)
13. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

You already know the headline: a generic type alias such as `type Set[T comparable] = map[T]struct{}` takes type parameters, and `Set[string]` is *identical* to `map[string]struct{}`. The middle-level questions are the ones that bite in real code: *exactly when are two alias instantiations identical?*, *how does the constraint on the alias interact with the constraint the right-hand side demands?*, *why is the no-methods rule a consequence rather than an arbitrary restriction?*, and *how does inference treat an alias differently from a defined type?*

This file zooms in on the semantic rules and the decisions around them. After reading you will:
- State the identity rule for generic aliases precisely, including for partial instantiation
- Reason about constraint compatibility between an alias and its RHS
- Explain the no-methods rule from first principles
- Predict how type inference behaves through an alias
- Choose between an alias and a defined generic type with confidence
- Diagnose cyclic-alias and constraint-mismatch errors from the message alone

---

## The Identity Rule, Precisely

Type identity is the entire point of an alias, so it pays to state it exactly.

For a generic alias `type Alias[P ...] = RHS`, the type `Alias[Args]` is **identical to the type obtained by substituting `Args` for the parameters `P` in `RHS`**. There is no intermediate named type. Concretely:

```go
type Pair[A, B any] = struct {
    First  A
    Second B
}
```

`Pair[int, string]` is identical to `struct{ First int; Second string }`. It is *also* identical to `OtherPair[int, string]` if some other alias resolves to the same struct, and to a hand-written variable of that exact anonymous-struct type. Identity is determined by the *resolved* type, not by the alias name that produced it.

This has three immediate consequences:

1. **No conversions.** Assignment between `Pair[int, string]` and the equivalent anonymous struct compiles with no cast.
2. **Type switches cannot distinguish them.** `case Pair[int,string]:` and `case struct{ First int; Second string }:` in the same switch are a duplicate-case error.
3. **Method sets come from the RHS.** `Pair[int, string]` has exactly the method set of `struct{ First int; Second string }` — which is empty. The alias adds nothing.

Contrast a *defined* generic type `type Pair2[A, B any] struct{ First A; Second B }`: `Pair2[int, string]` is a *new* type, distinct from the anonymous struct, requiring conversion and capable of carrying methods.

---

## Constraint Checking on the Alias

A generic alias declares its own type parameters with their own constraints, and those constraints are checked **at instantiation of the alias**, before substitution. Two layers interact:

1. **The alias's declared constraint** — what you wrote in brackets.
2. **The constraint the RHS implicitly requires** — what the right-hand side needs in order to be a well-formed type.

The alias's declared constraint must be **at least as strong** as the RHS demands. The classic case:

```go
type Set[T comparable] = map[T]struct{} // OK
type Bad[T any]        = map[T]struct{} // ERROR
```

A map key type must be comparable. `Set` declares `T comparable`, which satisfies that requirement, so substitution is always valid. `Bad` declares `T any`, which would permit non-comparable keys — the compiler rejects the declaration because the RHS could become ill-formed.

The rule generalizes: *the alias's parameter constraints must guarantee that every instantiation produces a valid RHS type.* You may declare a constraint **stronger** than necessary (e.g. `type Set[T cmp.Ordered] = map[T]struct{}` — ordered implies comparable), which simply restricts callers further. You may not declare one weaker than the RHS needs.

At the call site, the *instantiation* is checked against the alias's declared constraint:

```go
type Set[T comparable] = map[T]struct{}

var ok  Set[string] // string is comparable ✓
var bad Set[[]int]  // []int not comparable ✗ — checked against Set's own constraint
```

So there are two checkpoints: declaration time (alias constraint ⊇ RHS requirement) and instantiation time (argument satisfies alias constraint).

---

## Why You Cannot Declare Methods on an Alias

The no-methods rule is not a special case for generics; it follows directly from what an alias *is*.

Methods in Go are attached to a **defined type** (or a pointer to one), and the receiver type in a method declaration must be a defined type declared in the same package. An alias does not declare a new type — it names an existing one. So:

```go
type Set[T comparable] = map[T]struct{}
func (s Set[T]) Add(v T) {} // ERROR: invalid receiver type Set (alias)
```

If this were allowed, you would be attaching a method to `map[T]struct{}` — but you cannot declare methods on a type defined in another package, and you certainly cannot declare them on a composite type literal like `map[...]...`. The alias rule is the same rule that forbids `func (m map[string]int) Foo() {}`. The alias is transparent, so the receiver is effectively the composite map type, and that is not a legal receiver.

The takeaway: *transparency and methods are mutually exclusive.* An alias gives you a name and full type identity with the RHS; a defined type gives you a fresh type you can hang methods on. You pick one trade. There is no syntax that gives you both, by design.

When you need behavior, convert the alias to a defined type by deleting the `=`:

```go
type Set[T comparable] map[T]struct{}          // defined type
func (s Set[T]) Add(v T) { s[v] = struct{}{} }  // now legal
```

The cost: `Set[int]` is now distinct from `map[int]struct{}` and conversions are required when crossing that boundary.

---

## Partial and Full Instantiation

A generic alias may have several parameters, and you can build new names by *partially* fixing some of them through further aliases:

```go
type Map[K comparable, V any] = map[K]V

type StringMap[V any] = Map[string, V] // partial: K fixed to string
type IntSet          = Map[int, struct{}]    // full: both fixed (non-generic alias)
```

- `Map[K, V]` is the general two-parameter alias.
- `StringMap[V any] = Map[string, V]` fixes `K = string` and leaves `V` open — it is itself a *generic* alias with one parameter. `StringMap[int]` is identical to `map[string]int`.
- `IntSet = Map[int, struct{}]` fixes both — a plain (non-generic) alias naming `map[int]struct{}`.

Identity flows through every hop: `StringMap[bool]` is identical to `Map[string, bool]`, which is identical to `map[string]bool`. The number of remaining type parameters at each layer is exactly the number you left unbound.

This is the mechanism behind clean re-exports and domain vocabularies: you start from a general alias and progressively specialize it without ever creating a distinct type.

---

## Type Inference and Generic Aliases

Because an alias is transparent, inference generally operates on the *resolved* RHS, but the alias's parameters participate where the alias name appears explicitly.

Two situations matter:

**1. The alias used as a type literal.** When you write `Set[string]{}`, there is nothing to infer — you supplied the argument. When you write a function whose parameter type is an alias instantiation, inference for the *function's* type parameters works against the resolved type:

```go
type Slice[T any] = []T

func first[T any](s Slice[T]) T { return s[0] }

x := first([]int{1, 2, 3}) // T inferred as int from []int, via Slice[T] = []T
```

Here `Slice[T]` resolves to `[]T`, so passing `[]int` lets the compiler infer `T = int`. Inference sees through the alias to the structural `[]T`.

**2. Aliases as constraints or in constraint position** behave like the type they name; the alias does not add a new inference variable beyond its own parameters.

The practical rule: *an alias does not obstruct inference.* Anywhere the resolved RHS would allow inference, the alias allows it too, because the compiler unifies against the substituted form. Where people get surprised is expecting the alias to *introduce* extra inference (it does not) or to *hide* a parameter (it cannot — every parameter the RHS exposes is exposed through the alias's own parameter list).

---

## Aliasing Another Generic Alias

An alias's RHS may itself be (an instantiation of) another generic alias:

```go
type Result[T any]  = struct{ Value T; Err error }
type IntResult      = Result[int]         // alias of an instantiation
type Boxed[T any]   = Result[T]           // alias of a generic alias, still generic
```

- `IntResult` is identical to `struct{ Value int; Err error }`.
- `Boxed[T]` is a one-parameter alias identical, per `T`, to `Result[T]` and therefore to `struct{ Value T; Err error }`.

Each layer is resolved by substitution until a non-alias type is reached. The chain must **terminate** — if it loops back on itself, you get a cyclic-alias error (next section). As long as it terminates, identity is computed on the final resolved type, so `Boxed[string]`, `Result[string]`, and the raw struct are all the same type.

Keep chains short. Each hop is free at runtime but costs a reader a lookup. One level of indirection is usually the readable maximum.

---

## Alias vs Defined Generic Type: the Decision

This is the choice you will make most often. A compact decision matrix:

| Need | Use | Why |
|------|-----|-----|
| Methods on the type | Defined type | Aliases have no method set |
| A *distinct* type (unit safety, invariants) | Defined type | Aliases are identical to the RHS |
| Encapsulation / privacy boundary | Defined type | Aliases see straight through |
| Re-export preserving type identity | Alias | Defined type would break identity |
| Shorter name for a verbose generic literal | Alias | Transparent, no conversions |
| Gradual API migration / package move | Alias | Old and new names refer to the same type |
| Zero-conversion interop with the RHS | Alias | Identical types |

The heuristic: **alias for naming and identity-preservation; defined type for behavior and distinctness.** When in doubt, ask "do I ever want to write a method, or to keep this type apart from its underlying structure?" If yes, defined type. If you only want a friendlier spelling, alias.

A subtle but important case: re-exporting. Suppose `internal/store` defines `type Cache[K comparable, V any] struct{...}` with methods. A public package can re-export it as

```go
type Cache[K comparable, V any] = store.Cache[K, V]
```

The alias preserves identity *and* the underlying type's methods (because the method set comes from the RHS, which is the defined type `store.Cache`). This is the killer use case generic aliases unlocked: before 1.24 you could not parameterize the re-export, so you were forced into a wrapper that broke identity.

---

## Cyclic and Recursive Alias Errors

An alias must resolve, eventually, to a concrete type. If resolution loops, the compiler reports an invalid recursive (cyclic) alias.

```go
type A[T any] = B[T]
type B[T any] = A[T] // ERROR: invalid recursive type alias
```

Note the distinction from legitimately recursive *defined* types, which are allowed because the named type provides a finite reference point:

```go
type List[T any] struct {       // defined type — recursion is fine
    Head T
    Tail *List[T]               // refers to the named type, terminates
}
```

The defined `List` is allowed because `*List[T]` is a pointer to a *named* type — the recursion is broken by the name. An *alias* has no name to break the recursion: substituting `A[T]` for `B[T]` for `A[T]`... never bottoms out, so it is rejected.

Rule of thumb: aliases may *reference* other types (including generic ones) but the reference graph must be acyclic. If you need a self-referential structure, you need a defined type.

---

## The Version Timeline (1.23 experiment → 1.24 default)

Getting the version story right avoids a lot of confusion.

- **Proposal #46477** ("allow type parameters on type aliases") tracked the design over several years. Parameterized aliases were originally deferred from the initial Go generics release (Go 1.18) to keep that release scoped.
- **Go 1.23** shipped *partial, experimental* support gated behind `GOEXPERIMENT=aliastypeparams`. With that environment variable set, the compiler accepted generic alias declarations, but the feature was not on by default and had known gaps. You should not depend on the 1.23 form in production.
- **Go 1.24** made generic type aliases **fully supported and enabled by default.** No flag required. This is the version to target. The Go 1.24 release notes list it under language changes.

Practical guidance: set `go 1.24` in `go.mod`. That both enables the feature and gives contributors on older toolchains a clear version error instead of a baffling syntax error. Do not write code that relies on `GOEXPERIMENT=aliastypeparams` — it was a stepping stone, not a stable interface.

---

## Common Errors and Their Real Causes

### `invalid receiver type ... (alias)`

You tried to declare a method with an alias as the receiver. The alias is not a defined type. Fix: drop the `=` to make it a defined type, or attach the method to the underlying defined type instead.

### `T does not satisfy comparable` (at declaration)

The alias declares a constraint weaker than the RHS requires, e.g. `type Bad[T any] = map[T]struct{}`. Fix: tighten the alias's constraint (`T comparable`).

### `... does not satisfy comparable` (at instantiation)

You instantiated with an argument that violates the alias's constraint, e.g. `Set[[]int]`. Fix: use a satisfying type.

### `invalid recursive type alias`

The alias chain loops. Fix: break the cycle, or use a defined type where self-reference is required.

### `cannot use generic type Set without instantiation`

You used the bare alias name where a concrete type was expected. Fix: supply type arguments.

### `type aliases with type parameters require go1.24 or later`

Toolchain or `go` directive is too old. Fix: upgrade Go and set `go 1.24` in `go.mod`.

---

## Best Practices for Real Codebases

1. **Pick alias vs defined type deliberately.** Write down the reason in a comment if it is not obvious.
2. **Use aliases for re-export and migration**, where identity preservation is the whole value.
3. **Keep alias chains shallow** — one hop of indirection is readable; three is a maze.
4. **Match (or deliberately strengthen) the constraint** relative to the RHS; never try to weaken it.
5. **Document an alias as "identical to <RHS>"** so reviewers do not assume it is a distinct type.
6. **Set `go 1.24`** in `go.mod` and require it in CI so the feature is unambiguously available.
7. **Prefer naming shapes that carry intent** (`Handler[Req, Res]`) over trivial renames (`M[T] = map[string]T`).
8. **When re-exporting a type with methods, alias the defined type** so the method set transfers automatically.

---

## Pitfalls You Will Meet

### Pitfall 1 — Reaching for a method on an alias

The instinct after writing `type Set[T] = map[T]struct{}` is to add `Add`. It will not compile. Decide up front whether you need behavior; if so, start with a defined type.

### Pitfall 2 — Weakening the constraint by accident

Copying `type Set[T any] = map[T]struct{}` from memory fails to compile. Map keys need `comparable`. The RHS dictates the floor.

### Pitfall 3 — Expecting distinctness for safety

Using an alias to separate, say, `UserID` from `OrderID` will not work — both alias to the same underlying type and are interchangeable. Unit safety needs defined types.

### Pitfall 4 — Cyclic aliases in clever abstractions

Mutually referential aliases (`A → B → A`) compile-fail. If your design needs a cycle, a defined type is the only option.

### Pitfall 5 — Relying on the 1.23 experiment

Code that "works on my machine" because `GOEXPERIMENT=aliastypeparams` is set will break for teammates on a default 1.23 install. Target 1.24.

### Pitfall 6 — Over-aliasing standard containers

A package full of one-letter aliases for maps and slices is harder to read, not easier. Reserve aliases for shapes whose name genuinely clarifies intent.

### Pitfall 7 — Assuming inference is changed by the alias

It is not. Inference sees through to the RHS. If inference would fail on the raw type, the alias will not rescue it; if it would succeed, the alias does not block it.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] State the identity rule for `Alias[Args]` precisely
- [ ] Explain the two constraint checkpoints (declaration ⊇ RHS, instantiation ⊆ alias)
- [ ] Derive the no-methods rule from "an alias is not a defined type"
- [ ] Build a partially-instantiated alias and predict its remaining parameters
- [ ] Predict whether two alias instantiations are identical
- [ ] Explain how inference behaves through an alias
- [ ] Recognize and fix a cyclic-alias error vs a legal recursive defined type
- [ ] Recite the 1.23-experiment / 1.24-default timeline accurately
- [ ] Choose alias vs defined type for re-export, unit safety, and behavior
- [ ] Re-export a generic defined type via an alias and explain why the methods carry over

---

## Summary

A generic type alias is a *parameterized synonym*: `Alias[Args]` is identical to its right-hand side with `Args` substituted, with no intermediate type. That single fact generates every rule. Constraints are checked twice — the alias's declared constraint must be at least as strong as the RHS requires, and each instantiation must satisfy the alias's constraint. Methods are impossible because an alias is not a defined type and so cannot be a legal receiver; transparency and methods are mutually exclusive trades. Partial instantiation lets you specialize an alias step by step while preserving identity at every hop, which is exactly what makes generic aliases the clean tool for re-exporting and migrating generic types across packages — including re-exporting a defined type whose methods then carry over through the alias. Aliases may reference other aliases as long as the chain is acyclic; cycles need a defined type. The feature was experimental behind `GOEXPERIMENT=aliastypeparams` in Go 1.23 and became the default in Go 1.24, which is the version to target. When you need behavior, distinctness, or encapsulation, use a defined generic type; when you need a transparent, identity-preserving name, use an alias.
