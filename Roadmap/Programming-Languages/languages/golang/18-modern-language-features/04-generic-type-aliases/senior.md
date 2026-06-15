# Generic Type Aliases — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Design Question: Identity-Preservation as a Feature](#the-design-question-identity-preservation-as-a-feature)
3. [Re-Exporting a Generic Type Without Breaking Identity](#re-exporting-a-generic-type-without-breaking-identity)
4. [Gradual API Migration With Generic Aliases](#gradual-api-migration-with-generic-aliases)
5. [Aliases at Package Boundaries: What Transfers and What Does Not](#aliases-at-package-boundaries-what-transfers-and-what-does-not)
6. [Constraint Compatibility Across a Re-Export](#constraint-compatibility-across-a-re-export)
7. [Alias vs Defined Type as an Architectural Choice](#alias-vs-defined-type-as-an-architectural-choice)
8. [Deprecation and Versioning Strategy](#deprecation-and-versioning-strategy)
9. [Backwards-Compatibility and the Go Compatibility Promise](#backwards-compatibility-and-the-go-compatibility-promise)
10. [Tooling, Diagnostics, and Reviewability](#tooling-diagnostics-and-reviewability)
11. [Anti-Patterns](#anti-patterns)
12. [Senior-Level Checklist](#senior-level-checklist)
13. [Summary](#summary)

---

## Introduction

A senior engineer's interest in generic type aliases is not the syntax — `type Set[T comparable] = map[T]struct{}` is a one-liner — but what the feature *unlocks at the level of API design and code evolution*. The mechanical content (identity rules, constraint checking, the no-methods rule) lives in [junior.md](junior.md) and [middle.md](middle.md). Here the question is: *where does identity-preserving parameterization change how you design and evolve a public API?*

The honest answer is that the single most valuable thing generic aliases buy you is the ability to **re-export and migrate generic types across package boundaries without breaking type identity**. Before Go 1.24, you could re-export a non-generic type with an alias but could not parameterize that re-export; the workaround — a wrapper defined type — created a *distinct* type, forcing every caller to convert and breaking interoperability. Generic aliases close that gap.

After reading you will:
- Treat identity-preservation as a deliberate API property, not an accident
- Re-export and migrate generic types across packages safely
- Reason about what transfers across an alias (method sets, constraints, exported-ness)
- Decide alias vs defined type as an architectural, not stylistic, choice
- Design deprecation paths that keep old and new names byte-compatible
- Avoid the anti-patterns that turn a transparent alias into a maintenance hazard

---

## The Design Question: Identity-Preservation as a Feature

Most type machinery in Go is about *creating distinctions*: a defined type separates `Celsius` from `float64` so the compiler stops you mixing them. An alias does the opposite — it deliberately *erases* a distinction, making two spellings refer to one type.

That erasure is a feature when the distinction would be a liability:

- **Across a package move**, you do not want old and new import paths to yield incompatible types. Callers holding the old type must still satisfy functions taking the new type. Identity-preservation guarantees it.
- **In a facade or re-export layer**, you want the public name to *be* the internal type, not a copy, so values flow between layers without conversion and without losing the underlying method set.
- **In an API that names a structural shape** (`Handler[Req, Res] = func(context.Context, Req) (Res, error)`), you want every caller's hand-written function literal to satisfy the named type automatically. A distinct type would require conversion.

The senior framing: choose an alias precisely when you want to **add a name without adding a type**. If you would not want callers to be forced to convert, and you do not need to attach behavior, an alias is the correct tool. The moment you want the compiler to *enforce a boundary*, you want a defined type instead. The two are not interchangeable; they encode opposite intentions.

---

## Re-Exporting a Generic Type Without Breaking Identity

This is the flagship use case. Consider an internal package that owns the real implementation:

```go
// internal/cache/cache.go
package cache

type Cache[K comparable, V any] struct {
    mu   sync.Mutex
    data map[K]V
}

func New[K comparable, V any]() *Cache[K, V] { /* ... */ }
func (c *Cache[K, V]) Get(k K) (V, bool)     { /* ... */ }
func (c *Cache[K, V]) Set(k K, v V)          { /* ... */ }
```

A public package wants to expose this without leaking the internal path:

```go
// pkg/store/store.go
package store

import "example.com/internal/cache"

// Generic alias — identity-preserving re-export.
type Cache[K comparable, V any] = cache.Cache[K, V]

// Re-export the constructor too (functions are values, no alias needed).
func New[K comparable, V any]() *Cache[K, V] { return cache.New[K, V]() }
```

What this achieves:

- `store.Cache[string, int]` is **identical** to `cache.Cache[string, int]`. A value of one is a value of the other; no conversion anywhere.
- The **method set transfers automatically**. `store.Cache[K, V]` has `Get`, `Set`, etc., because the method set comes from the RHS (the defined type `cache.Cache`). The alias does not — and cannot — declare methods, but it does not need to; it *names* a type that already has them.
- Callers can pass a `*store.Cache[string,int]` to any function expecting `*cache.Cache[string,int]` and vice versa.

The pre-1.24 alternative was a wrapper:

```go
type Cache[K comparable, V any] struct{ cache.Cache[K, V] } // distinct type!
```

That embeds rather than aliases, creating a *new* type. Now `store.Cache[string,int]` is **not** `cache.Cache[string,int]`; interop breaks, and you must forward every method by hand or rely on embedding's promotion (which does not preserve identity). Generic aliases make the wrapper unnecessary.

A caveat on `internal/`: aliasing does not bypass the `internal/` visibility rule for *constructing* values whose construction needs unexported access — but here `cache.New` is exported, so it is fine. The alias only renames the type; it does not grant new access to unexported fields or functions.

---

## Gradual API Migration With Generic Aliases

When you move or rename a generic type, an alias gives you a zero-break transition window.

### Moving a type to a new package

```go
// old: pkg/legacy/types.go
package legacy

// Deprecated: moved to pkg/core. This alias keeps old imports working.
type Widget[T any] = core.Widget[T]
```

```go
// new: pkg/core/types.go
package core

type Widget[T any] struct { /* ... */ }
```

Existing code importing `legacy.Widget[Foo]` keeps compiling, and because the alias is identity-preserving, a `legacy.Widget[Foo]` value is *the same type* as a `core.Widget[Foo]` value. You can migrate call sites incrementally — there is never a flag day where everything must switch at once.

### Renaming within a package

```go
// Deprecated: use Result. Kept for one release cycle.
type Outcome[T any] = Result[T]

type Result[T any] struct { Value T; Err error }
```

Both names refer to one type for the deprecation window; you delete the alias in a later major version.

The discipline this enables: **decouple the rename from the call-site updates.** The type lands in its new home immediately; the alias absorbs the compatibility burden; call sites move on their own schedule; the alias is removed when the migration completes.

---

## Aliases at Package Boundaries: What Transfers and What Does Not

When you alias a type from another package, reason carefully about what crosses the boundary.

**Transfers (because identity is preserved):**
- **The full method set** of the RHS type. `store.Cache` has every method `cache.Cache` has.
- **Constraints**, exactly as declared on the RHS (subject to the compatibility rule in the next section).
- **Assignability and identity.** Values interoperate with no conversion.
- **Underlying structure**, including field names and tags, if the RHS is a struct.

**Does not transfer / is not changed by the alias:**
- **`internal/` access rules.** The alias does not let you reach unexported fields or call unexported functions you could not already reach. If the RHS has unexported fields, you still cannot set them outside the owning package.
- **Exported-ness of the *name*.** `type widget[T any] = core.Widget[T]` (lowercase) is package-private regardless of the RHS being exported. The alias name's own capitalization controls its visibility.
- **The ability to add methods.** You cannot extend the type through the alias. To add behavior, wrap with a defined type (and accept the identity break) or add the method upstream.

A common boundary mistake is assuming the alias *re-grants* construction privileges. It does not. If `core.Widget` has only unexported fields and no exported constructor, aliasing it as `store.Widget` does not let `store`'s callers build one — they still need `core`'s constructor. Re-export the constructor explicitly (as a function), as shown earlier.

---

## Constraint Compatibility Across a Re-Export

When you re-export a generic type, the alias must declare type parameters whose constraints are **compatible** with the RHS. The safe rule: **copy the RHS's constraints verbatim.**

```go
// RHS:
type Cache[K comparable, V any] struct { /* ... */ }

// Re-export — constraints copied exactly:
type Cache[K comparable, V any] = cache.Cache[K, V]
```

You may *strengthen* a constraint on the alias (declare `K cmp.Ordered` where the RHS allows `K comparable`), which narrows what callers can instantiate — occasionally useful to expose a deliberately restricted view. You may **not** weaken it: declaring `K any` for an RHS that requires `K comparable` fails at declaration, because the substituted RHS could become ill-formed.

A subtler point: the constraint *interface itself* must be expressible at the alias site. If the RHS's constraint is an exported interface from another package, you reference it by import; if it is unexported, you cannot name it, and a verbatim re-export of that exact constraint is impossible — a signal that the type was not designed to be re-exported with that constraint. In practice, library authors who intend re-export use exported constraints (`comparable`, `any`, `cmp.Ordered`, or their own exported constraint interfaces).

Senior guidance: when designing a type you expect others to re-export, **use only exported, nameable constraints** so a verbatim alias is always possible. This is part of designing for downstream consumption.

---

## Alias vs Defined Type as an Architectural Choice

At the architecture level, the choice encodes intent about *coupling*.

- **An alias couples the names tightly.** `store.Cache` *is* `cache.Cache`. A change to the internal type's shape is immediately visible through the public name — there is no insulation layer. That is exactly what you want for a thin facade or a temporary migration shim, and exactly what you do *not* want if the public API should be insulated from internal churn.
- **A defined type decouples.** `type Cache[K, V] struct{ impl internal.Cache[K,V] }` creates a stable public type whose internals you can refactor freely, at the cost of forwarding methods and breaking identity with the internal type.

The trade is *transparency vs insulation*:

| Goal | Choice |
|------|--------|
| Thin re-export, identity must hold | Alias |
| Temporary migration shim | Alias |
| Stable public API insulated from internal refactors | Defined type (wrapper) |
| Need to add methods / invariants at the boundary | Defined type |
| Name a structural shape callers' literals must satisfy | Alias |
| Enforce a domain distinction (unit safety) | Defined type |

A mature library often uses *both*: aliases for genuinely-thin re-exports where the internal type is itself the intended public contract, and defined wrapper types where the public surface must evolve independently. The mistake is using an alias to "save typing" on a type you actually want to insulate — you have then welded your public API to an internal type you wanted freedom to change.

---

## Deprecation and Versioning Strategy

Generic aliases give you a clean deprecation lever.

A typical lifecycle for renaming a public generic type:

1. **Introduce** the new name as the real (defined) type, or move it to its new package.
2. **Leave an alias** at the old name/path with a `// Deprecated:` comment. Because identity is preserved, no downstream code breaks.
3. **Communicate** the deprecation (release notes, `staticcheck`/`go vet` deprecation warnings fire on `// Deprecated:` doc comments).
4. **Wait** at least one minor/major cycle, per your compatibility policy.
5. **Remove** the alias in a major version bump, after telemetry/grep shows the old name is unused.

Because the alias and the target are *the same type*, you never get the classic "two incompatible types during the transition" problem that a wrapper would cause. A function written against the new name accepts values created against the old name, and vice versa, throughout the window.

For modules following semver: adding an identity-preserving alias is a **non-breaking** change (it only adds a name). Removing one is **breaking** (it deletes an exported name) and belongs in a major version.

---

## Backwards-Compatibility and the Go Compatibility Promise

Two compatibility lenses matter.

**The language feature itself.** Generic type aliases are a Go 1.24 language feature. Code using them requires a toolchain ≥ 1.24 and a `go 1.24` (or later) directive. This is a hard floor: a library that adopts generic aliases in its public API forces all consumers onto Go 1.24+. For a widely-depended-on library, that is a real adoption decision — weigh it like any minimum-version bump. Set the `go` directive honestly so consumers get a clear error rather than a confusing parse failure.

**Your API's compatibility.** Within the constraint of the version floor, aliases are a *compatibility-friendly* tool:
- Adding an alias is additive and safe.
- Replacing a defined type with an alias of an identical-structure type elsewhere is safe *for callers* (identity is preserved) — though it may affect reflection-based code that reads the type's package/name (see Tooling below).
- Replacing an alias with a defined type of the same structure is **breaking**: callers that relied on identity with the RHS now face a distinct type.

The senior rule: treat "alias ↔ defined type" swaps on a public type as potentially breaking, because they change *identity*, which some callers (and reflection, and type switches) depend on — even when the structural shape is unchanged.

---

## Tooling, Diagnostics, and Reviewability

A few operational realities of generic aliases in a real codebase.

- **`go doc` and `pkg.go.dev`** render a generic alias by showing its target. Readers see that `store.Cache` is an alias for `cache.Cache[K, V]`. Good documentation; it also means you cannot hide the internal path purely by aliasing — the target is visible in docs.
- **Reflection.** At runtime, `reflect.TypeOf` reports the *resolved* type. For an alias of a defined type, you get the defined type's name and package (`cache.Cache`), not the alias name. Code that switches on `reflect.Type.Name()`/`PkgPath()` sees through the alias. This is occasionally surprising when the alias was meant to "hide" the source package — it does not, at the reflection layer.
- **Type switches and `errors.As`-style matching** match on the resolved type. The alias and its RHS are indistinguishable to a type switch (and a `case` for both is a duplicate-case error).
- **Review.** An alias of an internal type *exposes that internal type's evolution surface*. Reviewers should treat adding a public alias of an internal type as widening the public contract — because it is. The internal type can no longer change freely without affecting the public name.
- **`staticcheck`/`go vet`** honor `// Deprecated:` on aliases, so a deprecation comment on a migration alias produces the expected linter warnings downstream.

---

## Anti-Patterns

- **Aliasing an internal type you actually want to insulate.** If the public API should evolve independently of the internal type, an alias welds them together. Use a defined wrapper.
- **Using an alias for unit safety.** `type UserID = int64` and `type OrderID = int64` are interchangeable — the compiler will not stop you mixing them. Unit/identity safety requires defined types.
- **Deep alias chains across packages.** `a.X → b.X → c.X → d.X` is legal but makes the real type three lookups away. Keep re-export chains to one hop.
- **Replacing a public defined type with an alias (or vice versa) casually.** It changes identity; treat it as a potentially breaking change.
- **Re-exporting via alias but forgetting to re-export the constructor.** Callers can name the type but cannot build it if construction needs the source package. Re-export the constructor function explicitly.
- **Adopting generic aliases in a widely-used library without acknowledging the Go 1.24 floor.** You have just bumped every consumer's minimum toolchain.
- **Assuming the alias hides the source package.** Docs and reflection reveal the target. If hiding is a real requirement, you need a wrapper type, not an alias.
- **Declaring a weaker constraint on the alias than the RHS needs.** It will not compile; copy the RHS constraints verbatim (or strengthen).
- **Leaving migration aliases in place forever.** A deprecation alias that never gets removed becomes permanent API surface and quiet coupling. Schedule its removal.

---

## Senior-Level Checklist

- [ ] Choose alias vs defined type by *intent*: transparency/identity vs distinctness/behavior
- [ ] Use generic aliases for identity-preserving re-export of generic types
- [ ] Re-export the constructor function alongside an aliased type
- [ ] Copy RHS constraints verbatim on a re-export (or deliberately strengthen)
- [ ] Design types intended for re-export with *exported*, nameable constraints
- [ ] Use aliases as zero-break migration shims; tag them `// Deprecated:`
- [ ] Schedule removal of migration aliases; do not let them become permanent
- [ ] Treat alias ↔ defined-type swaps on public types as potentially breaking
- [ ] Acknowledge the Go 1.24 minimum-version floor before adopting in a public API
- [ ] Remember reflection and docs see through the alias to the resolved type
- [ ] Do not use aliases for unit/identity safety — that needs defined types
- [ ] Keep re-export chains to a single hop for reviewability

---

## Summary

At senior level, the generic type alias is an *API-evolution and re-export* tool, and its defining property — identity-preservation — is the whole value proposition. It lets a package re-export another package's generic type under a new name such that the two are *the same type*, with the underlying method set carried over automatically, eliminating the pre-1.24 wrapper-type workaround that broke identity and forced conversions. The same property makes it the clean mechanism for gradual API migration: land the type in its new home, leave an identity-preserving alias behind, move call sites on their own schedule, and remove the alias in a later major version.

The architectural choice between alias and defined type encodes *coupling*: an alias welds the public name to the underlying type (great for thin facades and migrations, wrong when you want insulation); a defined wrapper decouples them (great for a stable public surface, at the cost of identity and forwarding). Constraints must be copied verbatim or strengthened, never weakened; types you intend to be re-exportable should expose only nameable constraints. Adopting the feature imposes a Go 1.24 floor on every consumer — a real decision for a popular library. And remember the limits of transparency: aliases do not grant access to unexported members, do not hide the target from docs or reflection, and cannot carry their own methods. Used with those rules in mind, generic aliases remove a long-standing papercut in evolving generic Go APIs.
