# Generic Type Aliases — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Spec Mechanics: Alias Declarations With Type Parameters](#the-spec-mechanics-alias-declarations-with-type-parameters)
3. [Type Identity Under Substitution](#type-identity-under-substitution)
4. [Constraint Well-Formedness and the Declaration-Time Check](#constraint-well-formedness-and-the-declaration-time-check)
5. [Why Methods Are Impossible: the Receiver Rule](#why-methods-are-impossible-the-receiver-rule)
6. [Inference Through Aliases](#inference-through-aliases)
7. [The Implementation Path: 46477, aliastypeparams, 1.24](#the-implementation-path-46477-aliastypeparams-124)
8. [How the Compiler Represents an Alias (go/types)](#how-the-compiler-represents-an-alias-gotypes)
9. [Reflection and Runtime Representation](#reflection-and-runtime-representation)
10. [Edge Cases the Spec and Compiler Reveal](#edge-cases-the-spec-and-compiler-reveal)
11. [Interaction With the Compatibility and Toolchain Machinery](#interaction-with-the-compatibility-and-toolchain-machinery)
12. [Programmatic Inspection and Tooling](#programmatic-inspection-and-tooling)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

The professional level treats a generic type alias not as a convenience but as a precise point in Go's type system: a *parameterized alias declaration* whose instantiation is defined by substitution, governed by the same identity, constraint, and receiver rules that govern the rest of the language. The syntax is trivial; the value is in knowing exactly which spec clauses apply, how the compiler models the declaration, what reflection reports at runtime, and where the corner cases live.

This file is for engineers who maintain Go infrastructure, write code generators or analysis tools over `go/types`, design libraries whose public API others re-export, or own the correctness of type-level abstractions. After reading you will:

- Know which spec sections govern parameterized alias declarations and how they compose
- State the identity rule as substitution and reason about it formally
- Explain the declaration-time constraint well-formedness check
- Derive the no-methods rule from the receiver clause, not from memory
- Reason about inference through an alias as unification against the resolved type
- Recount the 46477 → `aliastypeparams` → Go 1.24 path accurately
- Inspect aliases programmatically via `go/types` and `reflect`

`type Set[T comparable] = map[T]struct{}` is one line; the contract behind it spans alias declarations, type identity, type parameter constraints, and method receivers. Knowing where each rule sits is the professional insight.

---

## The Spec Mechanics: Alias Declarations With Type Parameters

The governing clause is the spec's **"Alias declarations"** (`go.dev/ref/spec#Alias_declarations`). As of Go 1.24 it permits an optional type parameter list:

```
AliasDecl = identifier [ TypeParameters ] "=" Type .
```

Reading the grammar: an alias is an identifier, an optional `TypeParameters` list (the brackets), the `=` token, and a `Type` (the right-hand side). When the `TypeParameters` list is present, the alias is *generic* and must be instantiated before use, exactly like a generic defined type.

Three properties follow directly from the spec text:

1. **The alias denotes the RHS type.** The spec states an alias declaration "binds an identifier to the given type." For a generic alias, it binds the identifier (parameterized) to the RHS *as a function of the type parameters*.
2. **Instantiation substitutes.** `Alias[Args]` denotes the type produced by substituting `Args` for the parameters in the RHS — per the spec's **"Instantiations"** rules, which apply uniformly to generic functions, generic defined types, and now generic aliases.
3. **The RHS may reference the parameters.** Each parameter in the list may appear in the RHS, and the substitution replaces every occurrence.

The crucial spec consequence: a generic alias does **not** introduce a new defined type. It is, in spec terms, a *type name* that denotes the substituted RHS. Everything else (identity, methods, assignability) is then determined by the rules for that denoted type.

---

## Type Identity Under Substitution

Identity is defined by the spec's **"Type identity"** section. For aliases, the operative principle is that an alias denotes its RHS — there is no separate identity for the alias name. Therefore:

> `Alias[Args]` is identical to `subst(RHS, params → Args)`.

Worked formally for `type Pair[A, B any] = struct{ First A; Second B }`:

```
Pair[int, string]
  = subst(struct{ First A; Second B }, {A→int, B→string})
  = struct{ First int; Second string }
```

So `Pair[int, string]` is identical to the anonymous struct `struct{ First int; Second string }`, and identical to any other alias instantiation that substitutes to the same struct. Identity composes through chains: if `type Boxed[T any] = Pair[T, error]`, then `Boxed[int]` substitutes to `Pair[int, error]`, which substitutes to `struct{ First int; Second error }`.

Two engineering consequences a tool author must respect:

- **Identity is structural after substitution**, governed entirely by the RHS's resolved type. The alias name carries no identity weight.
- **Defined types interrupt the substitution at their name.** If the RHS is (or contains) a *defined* generic type, identity is determined by that defined type's name + type arguments, not by its underlying structure. `type C[K comparable, V any] = pkg.Cache[K, V]` makes `C[string,int]` identical to `pkg.Cache[string,int]` (a named-type identity), not to `pkg.Cache`'s underlying struct.

This distinction — alias resolves to RHS, defined type stops at its name — is the single fact that explains every identity question about aliases.

---

## Constraint Well-Formedness and the Declaration-Time Check

The spec requires that a type be well-formed for every permitted instantiation. For a generic alias this produces a *declaration-time* obligation: **the alias's parameter constraints must guarantee the RHS is a valid type for every satisfying argument.**

The canonical case is the map-key requirement:

```go
type Set[T comparable] = map[T]struct{} // OK
type Bad[T any]        = map[T]struct{} // rejected at declaration
```

`map[T]struct{}` is well-formed only when `T` is comparable (the spec's map-type rule requires comparable keys). `Set` declares `T comparable`, so every instantiation yields a valid map type — the declaration is accepted. `Bad` declares `T any`, which would permit `Bad[[]int]` whose RHS `map[[]int]struct{}` is ill-formed; the compiler rejects the *declaration*, not merely the bad instantiation.

The rule, stated generally: *for a generic alias, the declared constraints must be at least as strong as the constraints the RHS imposes on the parameters.* You may declare strictly stronger constraints (narrowing callers); you may not declare weaker ones.

This mirrors the obligation on generic defined types, where the underlying type imposes the same floor. The difference is purely that the alias's RHS is the *literal* type rather than an underlying type behind a name.

A second checkpoint is the ordinary **instantiation-time** check: `Set[Arg]` requires `Arg` to satisfy `comparable`. Both checks use the standard constraint-satisfaction machinery (`go.dev/ref/spec#Satisfying_a_constraint`); aliases add no new constraint semantics.

---

## Why Methods Are Impossible: the Receiver Rule

The spec's **"Method declarations"** section states that the receiver's type must be a *defined type* `T` or `*T`, where `T` is declared in the same package as the method. An alias is not a defined type — it is a name denoting another type — so it can never be a legal receiver base.

```go
type Set[T comparable] = map[T]struct{}
func (s Set[T]) Add(v T) {} // illegal: receiver base is not a defined type
```

Substituting the alias gives a receiver base of `map[T]struct{}`, a composite type literal, which the receiver rule forbids (you cannot declare methods on `map[...]...`). The error is the *same* error you would get attempting `func (m map[string]int) F() {}`. There is nothing alias-specific about it; the alias is transparent and the transparency reveals an illegal receiver.

The professional framing: *methods require a defined type because Go associates method sets with defined types, identified by name.* An alias has no name in the identity sense — it denotes — so there is no entity to associate a method set with. This is why "transparency" and "methods" are structurally exclusive, not merely disallowed by fiat.

When a tool needs to know "does this aliased type have method `M`?", the answer comes from the *RHS's* method set. For `type C[K,V] = pkg.Cache[K,V]`, `C[string,int]`'s method set is `pkg.Cache[string,int]`'s method set — full, because the RHS is a defined type with methods. For `type Set[T] = map[T]struct{}`, the method set is empty, because maps have none.

---

## Inference Through Aliases

Type inference (spec: **"Type inference"**) unifies the types of arguments against parameterized signatures. Because an alias denotes its RHS, inference proceeds against the *resolved* RHS.

```go
type Slice[T any] = []T

func head[T any](s Slice[T]) T { return s[0] }

_ = head([]int{1, 2, 3}) // T inferred = int
```

Mechanically: the parameter type `Slice[T]` resolves to `[]T`; the argument `[]int` unifies with `[]T`, yielding `T = int`. The alias is invisible to inference except as a substitution step. Two facts a tool author must encode:

1. **An alias does not introduce inference variables beyond its own parameters.** It cannot "absorb" an inference obligation; it only renames.
2. **Inference against an alias of a *defined* generic type unifies against that named type.** `func f[K comparable, V any](c C[K, V])` with `type C[K,V] = pkg.Cache[K,V]` unifies arguments against `pkg.Cache[K, V]` — the named type — which is exactly what would happen had you written `pkg.Cache[K, V]` directly.

The honest summary: an alias never changes what inference can or cannot do. If inference succeeds against the resolved type, it succeeds through the alias; if it fails, the alias does not help. This is by construction — the alias is a denotation, not a new abstraction layer.

---

## The Implementation Path: 46477, aliastypeparams, 1.24

The precise timeline matters for compatibility decisions.

- **Proposal #46477**, "spec: allow type parameters on type aliases," tracked the design. Parameterized aliases were *deferred* from the original generics release (Go 1.18) deliberately, to keep the initial generics scope manageable and to resolve open questions about identity and instantiation interactions. The issue accumulated the design discussion over multiple releases.
- **Go 1.23** introduced *experimental, partial* support behind `GOEXPERIMENT=aliastypeparams`. Setting that environment variable at build time enabled the compiler and `go/types` to accept generic alias declarations. It was explicitly experimental: not on by default, with known limitations, and not covered by the compatibility promise. Production code must not depend on it.
- **Go 1.24** shipped **full support, on by default**, with no experiment flag. The Go 1.24 release notes list generic type aliases under language changes. From 1.24, `type Set[T comparable] = map[T]struct{}` is standard Go.

Compatibility implication: adopting generic aliases in a package's public API establishes a **Go 1.24 minimum** for all consumers. Set the `go` directive to `go 1.24` (or higher) so the toolchain enforces the floor and emits a clear diagnostic on older toolchains rather than an opaque parse error. Do not ship code paths that assume `GOEXPERIMENT=aliastypeparams`; treat 1.23 support as a stepping stone that no stable code should reference.

---

## How the Compiler Represents an Alias (go/types)

For tool authors, the `go/types` model is the source of truth. The package exposes `types.Alias` (a distinct `types.Type` kind for aliases). Key methods and facts:

- `types.Alias` represents an alias type. `(*types.Alias).Rhs()` returns the type the alias denotes.
- `types.Unalias(t)` follows alias indirections and returns the underlying non-alias type. Tools that reason about identity or structure should call `Unalias` (or `(*types.Alias).Rhs()` iteratively) before inspecting.
- For *generic* aliases, `(*types.Alias).TypeParams()` returns the alias's own type parameters, and `(*types.Alias).TypeArgs()` returns the arguments of an instantiated alias.
- `types.Instantiate` produces an instantiated alias; the result's identity is determined by the substituted RHS.

A practical rule for analyzers: **decide whether you care about the alias name or the denoted type.** If you are reporting source-level structure (e.g. "this declaration uses alias `store.Cache`"), keep the `types.Alias`. If you are reasoning about assignability, method sets, or identity, `Unalias` first so you compare resolved types. Forgetting to `Unalias` is the most common bug in generic-alias-aware tooling — two values that are identical at runtime appear different because one is wrapped in a `types.Alias` and the other is not.

(The exact API surface around `types.Alias` settled across Go 1.22–1.24; verify method availability against the toolchain version you build with, and gate on `go/types` from a 1.24+ toolchain when analyzing generic aliases.)

---

## Reflection and Runtime Representation

At runtime there is **no alias.** A generic alias is fully resolved at compile time; the produced type is its substituted RHS, and that is what exists in the binary.

```go
type Set[T comparable] = map[T]struct{}

reflect.TypeOf(Set[string]{}).String() // "map[string]struct {}"
```

Consequences:

- `reflect.Type.Name()` and `PkgPath()` report the **resolved** type. For `type Set[T] = map[T]struct{}`, the reflected type is an unnamed map (`Name()` is empty). For `type C[K,V] = pkg.Cache[K,V]`, the reflected type is `pkg.Cache[...]` — the *defined* type the alias denotes, with `PkgPath()` pointing at `pkg`, **not** at the aliasing package.
- Code that switches on reflected type names sees through the alias. An alias never "rebrands" a type at runtime; it cannot hide the source package from reflection.
- There is zero runtime cost: no wrapper, no indirection, no allocation. `Set[int]` performs identically to `map[int]struct{}` because it *is* that type in the compiled program.

This is the same as non-generic aliases: `type Bytes = []byte` reflects as `[]uint8`. Generic aliases add parameters but not runtime presence.

---

## Edge Cases the Spec and Compiler Reveal

- **Cyclic aliases are rejected.** `type A[T any] = B[T]; type B[T any] = A[T]` produces "invalid recursive type alias." Substitution never terminates. A *defined* type breaks the cycle via its name (`type List[T any] struct{ Tail *List[T] }` is fine); an alias has no name to break it.
- **Partial instantiation builds new generic aliases.** `type StringMap[V any] = Map[string, V]` is a one-parameter alias; identity flows through to `map[string]V`.
- **Constraint strengthening is allowed, weakening is not.** `type Set[T cmp.Ordered] = map[T]struct{}` (stronger than the comparable floor) is valid and narrows callers.
- **Aliasing a defined type preserves named-type identity, not structural.** `C[string,int]` is `pkg.Cache[string,int]`, which is *not* identical to a hand-written struct of the same shape.
- **Unexported constraints cannot be named at a re-export site.** If the RHS's constraint is an unexported interface from another package, a verbatim alias of that exact constraint is impossible; the type was not designed for cross-package re-export.
- **The alias name's visibility is independent of the RHS.** Lowercase alias name ⇒ package-private, regardless of the RHS being exported.
- **`internal/` rules are unaffected.** Aliasing does not grant access to unexported fields or functions; construction may still require the owning package's constructor.
- **Type switches treat alias and RHS as one.** A `case Alias[X]:` and `case <resolved RHS>:` in the same switch is a duplicate-case error.

These are not facts to memorize so much as pointers: when something surprises you, reach for the spec's identity/instantiation rules or `go/types`' `Unalias`, and the behavior resolves cleanly.

---

## Interaction With the Compatibility and Toolchain Machinery

- **The `go` directive is the gate.** `go 1.24` (or higher) in `go.mod` enables the feature and enforces the minimum toolchain. With an older directive, a 1.24 toolchain may still parse the syntax, but you should set the directive to match the language version you use; tooling and `gopls` key behavior off it.
- **`GOTOOLCHAIN`** governs which toolchain runs; ensure CI uses ≥ 1.24 when building or analyzing code that uses generic aliases.
- **Module consumers inherit the floor.** A dependency that uses generic aliases in exported API forces consumers to a 1.24+ toolchain. Treat this like any minimum-version bump: a *minor*, but real, compatibility event.
- **Vendoring and code-gen are unaffected** beyond the version floor: a generic alias is ordinary source. Generators that emit `go/types`-derived code must `Unalias` appropriately to avoid emitting the alias name where the resolved type is required (or vice versa, depending on intent).

---

## Programmatic Inspection and Tooling

When building analysis or generation tools:

### Resolve before comparing

```go
// Compare resolved types, not alias wrappers.
if types.Identical(types.Unalias(a), types.Unalias(b)) {
    // a and b denote the same type
}
```

### Distinguish alias from defined type

```go
switch t := typ.(type) {
case *types.Alias:
    // it's an alias; t.Rhs() is what it denotes,
    // t.TypeParams()/t.TypeArgs() expose generics
case *types.Named:
    // it's a defined type
}
```

### When to keep the alias

Keep the `*types.Alias` when your output is *source-facing* — diagnostics, doc generation, refactoring tools that should preserve the author's chosen name. Resolve it when your logic is *semantics-facing* — identity, assignability, method-set queries.

### Shelling out vs `go/types`

For one-off questions, `go doc <pkg>.<Alias>` shows the target. For structured analysis, load packages with `golang.org/x/tools/go/packages` and inspect via `go/types`. Re-implementing substitution by hand is error-prone; use `types.Instantiate` and `types.Unalias`.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Enable generic aliases | Set `go 1.24` in `go.mod`; build with a ≥ 1.24 toolchain. |
| Re-export a generic defined type | `type C[K comparable, V any] = pkg.C[K, V]`; re-export the constructor as a function. |
| Migrate a generic type to a new package | Move the defined type; leave `type Old[T any] = new.Type[T]` with `// Deprecated:`. |
| Fix "cannot define methods on alias" | Drop the `=` to make a defined type, or add the method upstream. |
| Fix "T does not satisfy comparable" at declaration | Strengthen the alias constraint to match the RHS floor. |
| Fix cyclic alias error | Break the cycle; use a defined type for self-reference. |
| Compare two types in a tool | `types.Identical(types.Unalias(a), types.Unalias(b))`. |
| Find an aliased type's methods | Inspect the RHS / `Unalias`ed defined type's method set. |
| Decide alias vs defined type | Need methods/distinctness/insulation → defined; need identity/naming → alias. |
| Check the runtime type | `reflect.TypeOf(x)` reports the resolved type; the alias is gone. |
| Audit min-version impact | Adopting in exported API forces consumers to Go 1.24+. |

---

## Summary

A generic type alias is, in spec terms, an *alias declaration with a type parameter list*: it binds a parameterized name that **denotes** its right-hand side, and `Alias[Args]` is identical to the RHS with `Args` substituted. Every downstream property follows from that denotation. Identity is structural after substitution — except where the RHS is a defined type, which stops resolution at its name. Constraints face two checks: a declaration-time obligation that the alias's constraints are at least as strong as the RHS requires, and the ordinary instantiation-time satisfaction check. Methods are impossible because the receiver rule demands a defined type and an alias is not one — transparency and method sets are structurally exclusive. Inference operates against the resolved type, neither adding nor removing inference power.

The feature spent years in proposal #46477, shipped experimentally behind `GOEXPERIMENT=aliastypeparams` in Go 1.23, and became the default in Go 1.24 — which is the version to target and the floor it imposes on consumers. In `go/types`, aliases are modeled as `types.Alias` with `Rhs`, `TypeParams`, and `TypeArgs`; tools must `Unalias` before reasoning about identity. At runtime the alias does not exist: reflection reports the resolved type, and there is zero overhead. Knowing exactly which rule governs each behavior — alias declarations, type identity, constraint well-formedness, method receivers — turns the one-line feature into a precise instrument for building and evolving generic Go APIs.
