# Type Inference — Specification Level

## Table of Contents
1. [Introduction](#introduction)
2. [Spec Sections That Govern Inference](#spec-sections-that-govern-inference)
3. [Type Argument Lists](#type-argument-lists)
4. [Type Inference: Overview](#type-inference-overview)
5. [Type Unification](#type-unification)
6. [Function Argument Type Inference (FTAI)](#function-argument-type-inference-ftai)
7. [Constraint Type Inference](#constraint-type-inference)
8. [Untyped Constants in Inference](#untyped-constants-in-inference)
9. [The Iterative Algorithm](#the-iterative-algorithm)
10. [Errors and Reporting](#errors-and-reporting)
11. [Spec Quotes With Commentary](#spec-quotes-with-commentary)
12. [Worked Spec-Style Examples](#worked-spec-style-examples)
13. [Differences From Earlier Versions](#differences-from-earlier-versions)
14. [Summary](#summary)

---

## Introduction

This document is a guided tour through the relevant sections of the Go specification (https://go.dev/ref/spec) that define type inference. The goal is not to reproduce the specification verbatim but to quote the load-bearing rules and explain them in terms a working engineer can apply to real code.

References in this document use the form *[spec: Type inference]* etc. Always verify against the current spec for your Go version.

---

## Spec Sections That Govern Inference

The relevant sections of the Go specification are:

- **Type parameters** — declares the syntax and semantics of `[T constraint]`.
- **Instantiation** — describes how a generic function or type is turned into a concrete one given type arguments.
- **Type inference** — top-level entry, lists subsections.
- **Type unification** — algorithmic basis.
- **Function argument type inference** — applies unification to argument/parameter pairs.
- **Constraint type inference** — uses constraint shape to determine remaining type parameters.

Spec terms used below:
- **Type parameter list**: the `[A, B, ...]` portion of a generic function or type signature.
- **Type argument list**: the `[T1, T2, ...]` written by the caller, possibly empty/partial.
- **Type set**: the set of types permitted by a constraint.
- **Core type**: when defined, the unique underlying type shared by the constraint's type set.

---

## Type Argument Lists

Per the spec, a generic function call `F[T1, T2](args)` produces an instantiation by substituting `T1, T2, ...` for the type parameters. If the type argument list is shorter than the type parameter list, the missing type arguments must be inferred.

If the list is empty (the call uses bare parentheses `F(args)`), all type arguments must be inferred.

> *"Each type argument must be a type that satisfies the corresponding type parameter's constraint."* — [spec: Instantiations]

So inference must:
1. Choose a type for each unbound type parameter.
2. Verify the chosen type satisfies the parameter's constraint.

If both succeed, instantiation proceeds.

---

## Type Inference: Overview

The spec defines type inference as the process that determines unbound type arguments using:

1. **Function argument typing** — when a generic function is called.
2. **Constraint typing** — derived from constraint structure.

The process is iterative; both can produce new substitutions, and a substitution from one may unblock the other.

> *"Type inference is based on type unification. A single unification step applies to a substitution map and a pair of types..."* — [spec: Type inference]

The substitution map starts with explicit type arguments. Inference adds entries until either every type parameter is mapped or no more progress is possible.

---

## Type Unification

Unification is the fundamental operation. Given two types `x` and `y`, possibly containing type parameters, and a current substitution map `M`, unification:

- Walks `x` and `y` in parallel.
- Records any type parameter mapping.
- Fails if any non-parameter mismatch is found.

### Cases (paraphrased from the spec)

1. If `x` and `y` are identical: success.
2. If `x` is a type parameter not yet in `M`: bind `M[x] = y`.
3. If `y` is a type parameter not yet in `M`: bind `M[y] = x`.
4. If both are type parameters bound in `M`: their existing bindings must unify.
5. For composite types (slices, maps, channels, function types, struct types, interface types, pointer types): recurse component-wise.
6. Otherwise: fail.

> *"Unification uses a combination of exact and loose unification depending on whether two types have to be identical, assignment-compatible, or only structurally equal."* — [spec: Type unification]

In Go 1.21+, the spec distinguishes:
- **Exact unification** — types must be identical.
- **Loose unification** — types must be assignable, considering untyped constants and named types.

Function argument type inference uses loose unification when the argument is an untyped constant or assignable to the parameter type.

### Composite-type recursion

The recursion rules are:

| If x is | And y is | Recurse on |
|---------|----------|-----------|
| `*A` | `*B` | `A` and `B` |
| `[]A` | `[]B` | `A` and `B` |
| `map[K1]V1` | `map[K2]V2` | `K1,K2` and `V1,V2` |
| `chan A` | `chan B` | `A` and `B` |
| `func(P1...) R1` | `func(P2...) R2` | each `Pi` and `R` |
| `struct{...}` | `struct{...}` | each field type |
| `interface{...}` | `interface{...}` | each method signature |

For named types, the underlying-type rule applies only when `~T` is in play in a constraint; otherwise the names must match.

---

## Function Argument Type Inference (FTAI)

> *"Function argument type inference uses the types of the function arguments at the call site to infer type arguments."* — [spec: Function argument type inference]

Algorithm (paraphrased):
1. Initialize substitution map `M` with explicit type arguments.
2. For each (typed) function argument `a_i` and corresponding parameter `p_i`, unify `type(a_i)` with `type(p_i)` under `M`.
3. Untyped constants are deferred: they do not contribute to inference initially.
4. After typed arguments are processed, untyped constants are processed using the now-narrowed `M`. Defaults apply only when no typed contribution constrained the parameter.

Key consequence: if a type parameter has *no* typed argument, untyped constants determine it via their defaults.

```go
func F[T int | float64](a, b T) T { return a + b }
F(1, 2) // both untyped int → defaults to int → T = int
F(1, 2.0) // 1 is untyped int, 2.0 is untyped float — but 1 is representable as float64, so T = float64.
```

---

## Constraint Type Inference

> *"Constraint type inference attempts to derive type arguments from constraint type parameters."* — [spec: Constraint type inference]

If a type parameter `T`'s constraint has a *core type* `C` that itself contains a type parameter `U`, then knowing `T` (or part of `T`'s structure) allows deriving `U`.

```go
func F[S ~[]E, E any](s S) E { return s[0] }

// FTAI: S = []int (because s has type []int).
// Constraint of S is ~[]E, which has core type []E.
// Unify []int with []E → E = int.
```

Constraint inference fires only when:
- The constraint has a core type.
- That core type contains an as-yet-unbound type parameter.
- A binding of the constrained parameter is already known.

If a constraint has no core type (e.g., `~int | ~string`), constraint inference cannot help.

---

## Untyped Constants in Inference

The spec dedicates careful prose to untyped constants because they interact non-trivially with inference.

Rules:
1. An untyped constant has a **default type** (e.g., `int` for `1`).
2. When unifying an untyped constant against a parameter of type `T` (a type parameter), the constant is treated as its default type *unless* a typed argument has already bound `T` to a type in which the constant is representable.
3. If no typed argument bound `T`, all untyped constants in matching positions must agree on a default type for `T`.

```go
F(1, 2)         // 1 and 2 both default to int → T = int
F(1, 2.0)       // 1 default int, 2.0 default float64. Combined: float64 wins because 1 is representable as float64.
F(int64(1), 2)  // typed int64 binds T = int64. Then 2 must be representable as int64. OK.
```

The Go 1.21 spec rewrite clarified these rules; earlier versions had less explicit handling and behaved more conservatively.

---

## The Iterative Algorithm

Inference is iterative. Pseudocode:

```
function Infer(call, signature):
    M ← explicit type arguments
    repeat:
        progress ← false
        progress |= FTAI(M, call, signature)
        progress |= ConstraintInference(M, signature)
    until not progress
    if all type parameters bound in M:
        return M
    else:
        error "cannot infer T"
```

The two phases can each unblock the other:
- FTAI may bind `S = []int`, after which constraint inference can derive `E = int` from `~[]E`.
- Constraint inference may bind `K = string`, after which a parameter of type `map[K]V` might be unifiable with the argument's `map[string]int`.

---

## Errors and Reporting

The spec requires the compiler to report inference failures with enough context to identify which type parameter could not be inferred. In practice, modern Go versions report:

```
cannot infer T (declared at file.go:5:9)
```

or in 1.22+:

```
cannot infer T: argument 2 of type fmt.Stringer is not assignable to T's constraint
```

Spec-level requirements:
- Report failure if any type parameter remains unbound.
- Report failure if any binding violates the parameter's constraint.
- Report failure if unification fails at any step.

---

## Spec Quotes With Commentary

### Quote 1: On the role of inference

> *"Type inference does not change the meaning of a program; it only avoids requiring the programmer to write the type arguments explicitly."*

**Commentary**: This is the cornerstone — inference is a notational convenience. Anything inferable could be written explicitly; nothing inferred can produce code that explicit instantiation could not.

### Quote 2: On unification's role

> *"Type inference solves type equations through type unification. Type unification recursively compares ... to determine whether they can be made identical (or assignable, depending on context)."*

**Commentary**: Two forms of unification — exact and loose — exist because Go's type system is a hybrid of identity and assignability. Loose unification is what allows untyped constants and named types to participate naturally.

### Quote 3: On constraint type inference

> *"Constraint type inference infers type arguments by considering type parameter constraints. ... If a type parameter t has a core type containing type parameters, those type parameters may be inferred from the type substituted for t."*

**Commentary**: The "core type" requirement is restrictive. A constraint like `~[]E` has core type `[]E` and works. A constraint like `~[]E | ~map[K]E` has no core type, so constraint inference cannot proceed.

### Quote 4: On the iterative nature

> *"Type inference repeatedly applies type unification until either all type parameters have been determined, or until no more substitutions can be made."*

**Commentary**: The fixed-point semantics matters. A single pass would miss many cases.

### Quote 5: On untyped constants

> *"During unification, untyped constants are considered with their default types, unless a more specific type has been determined for the corresponding type parameter."*

**Commentary**: The "unless" clause is critical. It is what makes `F(int32(1), 2)` work — the typed argument first establishes `T = int32`; the untyped `2` then has to be representable as `int32`.

---

## Worked Spec-Style Examples

### Example A: A pure FTAI case

```go
func F[T any](a T) T { return a }
F(42)
```

- `M = {}` (no explicit args).
- FTAI: unify `T` with `int` → `M = {T: int}`.
- All type params bound. Inference succeeds.

### Example B: FTAI + constraint inference

```go
func F[S ~[]E, E any](s S) E { return s[0] }
F([]string{"a", "b"})
```

- `M = {}`.
- FTAI: unify `S` with `[]string` → `M = {S: []string}`.
- Constraint inference: `S`'s constraint has core `[]E`. Unify `[]string` with `[]E` → `M = {S: []string, E: string}`.
- Done.

### Example C: Iteration required

```go
func F[K comparable, V any, M ~map[K]V](m M) V { /* ... */ }
F(map[string]int{"a": 1})
```

- `M = {}`.
- FTAI binds `M` (the type parameter) to `map[string]int`.
- Constraint inference: core of `~map[K]V` is `map[K]V`. Unify with `map[string]int` → `K = string, V = int`.
- Done.

### Example D: Iteration with untyped constants

```go
func F[T int | float64](a, b T) T { return a + b }
F(1, 2.0)
```

- `M = {}`.
- FTAI: typed args... none yet (both are untyped).
- Untyped constants: `1` defaults to `int`, `2.0` defaults to `float64`. Combined: try `float64` (the more general) — `1` is representable as `float64`, so `T = float64`.
- Done.

### Example E: Failure case

```go
func F[T any]() T { var z T; return z }
F()
```

- `M = {}`.
- FTAI: no arguments. No bindings.
- Constraint inference: constraint is `any`, no core type with parameters. No bindings.
- After fixed-point: `T` still unbound. Inference fails.

### Example F: Type set without core type

```go
type Mixed interface { ~int | ~string }
func F[T Mixed](x T) T { return x }
F("hi")
```

- FTAI: unify `T` with `string` → `T = string`.
- Constraint check: is `string` in `~int | ~string`? Yes (`~string` matches). OK.
- Done.

### Example G: Method value

```go
type S struct{}
func (S) Op(x int) string { return "ok" }

func F[T, U any](x T, f func(T) U) U { return f(x) }

s := S{}
F(42, s.Op) // method value has type func(int) string.
```

- FTAI: `T = int` (from 42). Then unify `func(T) U` with `func(int) string` → `U = string`.
- Done.

### Example H: Failure due to function-shape mismatch

```go
F([]int{1, 2}, fmt.Sprint)
// fmt.Sprint has type func(...any) string — not func(int) string.
// Unification: arities differ; loose unification fails.
// Inference fails.
```

---

## Differences From Earlier Versions

### Go 1.18
- The original spec had narrower unification.
- Untyped constant defaulting was less aggressive.
- Some function-shape cases that work in 1.21 failed.

### Go 1.21
- Spec rewrite of the inference section.
- Loose unification clarified.
- Function-shape inference improved (`Map(s, strconv.Itoa)` now works).

### Go 1.22+
- Further refinements; better error messages; small adjustments to untyped-constant rules in mixed contexts.

---

## Summary

The Go specification describes type inference as a fixed-point iteration over type unification. Function argument type inference draws bindings from arguments; constraint type inference draws bindings from constraint shape. Untyped constants are folded in via default types and representability. Loose unification handles named types and assignment compatibility. Inference never changes program meaning — it only saves keystrokes — and a careful reading of the spec will tell you precisely which calls will and will not work in any given Go version.
