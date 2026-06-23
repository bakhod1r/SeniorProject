# Generic Type Aliases — Professional Level

## Table of Contents
1. [The 1.24 release in context](#the-124-release-in-context)
2. [Real use case: moving generic types between packages](#real-use-case-moving-generic-types-between-packages)
3. [API design: re-export vs facade vs new type](#api-design-re-export-vs-facade-vs-new-type)
4. [Deprecation patterns](#deprecation-patterns)
5. [Case study: a SDK split](#case-study-a-sdk-split)
6. [Case study: vendored generic library](#case-study-vendored-generic-library)
7. [Case study: stdlib uptake](#case-study-stdlib-uptake)
8. [Module compatibility windows](#module-compatibility-windows)
9. [Team-level guidelines](#team-level-guidelines)
10. [Migration checklist](#migration-checklist)
11. [Summary](#summary)

---

## The 1.24 release in context

Go 1.24 (February 2025) shipped two major features for generics users:

- **Generic type aliases** — the topic of this file.
- **`weak.Pointer[T]`** — the first stdlib generic that was awaited specifically for runtime work.

The release notes explicitly call out that "type aliases may now have type parameters". For a lot of teams this was the most impactful single change of the release because it unblocked migrations they had been postponing since 2022.

The Go team had run the feature behind `GOEXPERIMENT=aliastypeparams` in 1.22 and 1.23 to gather feedback. The default-on switch in 1.24 was uneventful — by then the rough edges had been ironed out.

---

## Real use case: moving generic types between packages

A canonical professional use case: you have a generic type that lived in package `pkg/old` for two years, and now you want to move it to `pkg/new` for organisational reasons.

### Before generic aliases

Without alias support, you had two unattractive options:

1. **Hard move** — change every caller. Cross-team coordination, breaking changes, version bump, pain.
2. **Wrapper layer** — `pkg/old` keeps a wrapper struct that embeds `pkg/new.Type`. Methods need to be re-forwarded. Identity is lost; callers cannot pass `pkg/old.Type` where `pkg/new.Type` is expected.

Both paths cost weeks of engineering time on big codebases.

### With generic aliases

```go
// pkg/new — new owner of the generic type
package new

type Result[T any] struct {
    Value T
    Err   error
}

func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }
```

```go
// pkg/old — keeps callers happy with a one-line alias
package old

import "example.com/pkg/new"

// Result is now defined in pkg/new. The alias preserves backwards
// compatibility for callers that still import this package.
//
// Deprecated: use new.Result.
type Result[T any] = new.Result[T]
```

Existing callers using `old.Result[int]` continue to compile and run. The two names refer to the **same type** at every level. New callers gradually move to `new.Result[int]`.

### Cost

One file edit in `pkg/old`, one file edit in `pkg/new`, no API breakage. This is the kind of refactor that used to take a sprint and now takes an afternoon.

---

## API design: re-export vs facade vs new type

Three patterns map to three intents:

### Re-export (alias)

```go
type Result[T any] = newpkg.Result[T]
```

Use when: the type belongs **conceptually** to another package; you only want a synonym.

### Facade (curated re-exports)

```go
package api

type (
    Request[B any]  = transport.Request[B]
    Response[B any] = transport.Response[B]
    Token           = auth.Token
)
```

Use when: you are publishing a curated entry point over multiple internal packages. Aliases here keep identity so user code can pass values through to deeper packages without conversions.

### New type (defined type)

```go
type Result[T any] newpkg.Result[T]
```

Use when: you want **independent identity**. Callers must convert between yours and theirs. Methods can be added locally. Use this for domain-specific wrappers.

The senior engineer chooses **one of the three** per public symbol. Mixing styles inside a package leads to user confusion — they cannot predict whether a name is a true synonym or a brand-new type.

---

## Deprecation patterns

When an alias is intended as a transitional shim, signal the intent clearly.

### The `Deprecated:` comment

```go
// Result is the legacy alias for new.Result.
//
// Deprecated: use new.Result.
type Result[T any] = new.Result[T]
```

`gopls` and most IDEs render the `Deprecated:` line in a strikethrough on hover. `staticcheck` flags uses of deprecated symbols.

### Two-release window

A common policy:

1. Release N: introduce the new home; alias from the old location.
2. Release N+1: still working — both names valid.
3. Release N+2: remove the old alias.

Inside a single major version, this is acceptable. Between major versions, you can be more aggressive.

### Compile-time-only aliases

There is no runtime cost to keeping an alias forever. You may keep deprecated aliases indefinitely if removing them is more disruptive than maintaining a single line of code.

The right question: **does this alias confuse readers?** If yes, schedule removal. If no, leave it.

---

## Case study: a SDK split

A real pattern from cloud SDKs (AWS, GCP, Azure-style):

**Initial state**: one giant module, `cloud-sdk`, exporting hundreds of generic types under a flat namespace.

**Goal**: split into per-service sub-modules: `cloud-sdk/storage`, `cloud-sdk/compute`, etc.

**Without generic aliases**: every customer must change every import line. Multi-million-LoC fleet code refactor. Months of work on the consumer side.

**With generic aliases**: the root `cloud-sdk` package keeps re-exports for two releases:

```go
// cloud-sdk/cloud_sdk.go
package cloudsdk

import (
    "example.com/cloud-sdk/storage"
    "example.com/cloud-sdk/compute"
)

// Deprecated: use storage.Bucket.
type Bucket[T any] = storage.Bucket[T]

// Deprecated: use compute.Instance.
type Instance[Cfg any] = compute.Instance[Cfg]
```

Customers migrate at their own pace. CI in the SDK repo enforces "no new uses in stdlib of the deprecated names". After two release cycles, the deprecated aliases are removed.

Lessons:

- **Generic aliases enable graceful split refactors** at scale.
- **Deprecation discipline** is essential — without it, deprecated names accumulate.
- **Consumer-side burden is minimised**: existing imports keep working.

---

## Case study: vendored generic library

A finance company forks an upstream generic library (say, `decimal/v3`) into its internal monorepo at `internal/finlib/decimal`. Existing internal code imports the upstream path; new policy requires the internal mirror.

```go
// internal/finlib/decimal/decimal.go
package decimal

import upstream "example.com/decimal/v3"

type Big[Prec PrecisionConstraint] = upstream.Big[Prec]
type Constraints                    = upstream.Constraints
```

Callers inside the company can switch to `internal/finlib/decimal.Big[Prec]` and the values flow seamlessly to upstream functions because of identity preservation. Over time, internal code targets the alias; if the company ever needs to swap implementations, only the alias file changes.

Caveat: aliases preserve identity only when both names reference the **same** underlying type. If the internal library decides to maintain a divergent fork, the alias must be replaced with a defined type — at which point all consumers need to update.

---

## Case study: stdlib uptake

The standard library has been deliberate about adopting generic aliases.

| Package | Adoption |
|---------|----------|
| `slices` | Added in 1.21 — no aliases yet. |
| `iter` | Added in 1.23 — generic types `Seq[V]`, `Seq2[K, V]` are defined types, not aliases. |
| `weak` | Added in 1.24 — `weak.Pointer[T]` is a defined type. |
| Internal `cmd/compile` test fixtures | Use generic aliases since 1.22 to verify the implementation. |

The pattern: **stdlib prefers defined types** for new generic exports because the standard library values stable, distinct identity. Generic aliases are not absent from stdlib but they are typically **internal** uses — re-exports during refactors that ship in the same release.

The lesson for application-level engineers: aliases are wonderful for **inter-module** migrations, but inside a single module the team probably wants defined types so that public APIs remain crisp.

---

## Module compatibility windows

A practical timeline for a library that wants to adopt generic aliases without leaving Go 1.18 - 1.23 users behind:

1. **Phase 0 — pre-adoption.** Use defined types or wrappers. `go.mod`'s `go` directive is `1.18`.
2. **Phase 1 — opt-in.** A separate module path or build tag gates the feature. `go.mod` set to `1.22` with `GOEXPERIMENT=aliastypeparams`. Risky; few libraries chose this path.
3. **Phase 2 — bumped minimum.** Library bumps `go` directive to `1.24`. Aliases become free. Older users must stay on the previous library version.
4. **Phase 3 — alias-native.** New API uses generic aliases by default. Old workarounds in the codebase are cleaned up.

Most libraries skip Phase 1 entirely. The pragmatic rule: wait until the team's minimum supported Go version is **at least N+1** where N is the version that introduced the feature. For 1.24 generic aliases, that meant most libraries enabled them only after 1.25 was current.

### Compatibility risk

Bumping the `go` directive to `1.24` excludes anyone on older toolchains. For widely used libraries, this is a meaningful policy decision — coordinate with downstream consumers.

---

## Team-level guidelines

A typical team rulebook for generic aliases:

> 1. Aliases are for **re-exports** and **migration shims**, not for inventing names.
> 2. Every alias in a public package gets a comment explaining its purpose.
> 3. Aliases that exist only for backwards compatibility get a `Deprecated:` line.
> 4. Do not stack aliases more than one level deep.
> 5. Never alias a type to add or change behaviour — use a defined type or wrapper.
> 6. Bumping `go.mod`'s `go` directive to `1.24` requires a CI compatibility check.
> 7. Linters must pass after the bump (`staticcheck`, `golangci-lint`).

### Code review checklist

| Check | Why |
|-------|-----|
| Is this alias really a re-export? | Otherwise consider a defined type. |
| Does it carry a comment / `Deprecated:`? | Readers need intent. |
| Are the type parameters identical to the source? | Diverging confuses future maintainers. |
| Is the constraint at least as strict as the source? | The compiler will fail otherwise. |
| Is the import path stable? | Aliases pinned to a soon-to-be-removed package will rot. |

---

## Migration checklist

A pragmatic checklist for a team about to adopt generic aliases:

- [ ] `go.mod`'s `go` directive bumped to `1.24` or later.
- [ ] CI has at least one Go 1.24+ build.
- [ ] `gopls` and `golangci-lint` updated to versions that recognise parameterised aliases.
- [ ] Style guide updated with "aliases for re-exports, defined types for ownership".
- [ ] At least one team member has read the 1.24 release notes.
- [ ] All deprecation shims are documented with `// Deprecated:` comments.
- [ ] Public API impact reviewed — alias vs defined type chosen deliberately.
- [ ] No alias chains longer than one hop.
- [ ] Constraint mismatches caught by `go vet` or `staticcheck`.
- [ ] Documentation (README, godoc) updated to mention the new structure.
- [ ] Downstream consumers notified if minimum Go version was bumped.

---

## Summary

The professional view of generic aliases is **strategic**. The feature enables clean migrations at scale, lets libraries split into sub-packages without breaking consumers, and gives facade packages a way to expose identity-preserving names. Three rules guide professional use:

1. **Aliases for identity, defined types for ownership, wrappers for behaviour.**
2. **Document every alias** — especially deprecation shims.
3. **Coordinate the minimum Go version bump** with downstream consumers.

Real cases — SDK splits, vendored forks, internal facade packages — demonstrate that generic aliases unblock work that previously required either breaking changes or tedious wrapper code. The 1.24 release was small in syntax, but it removes one of the last architectural frictions in Go's generics design.

Used carefully, generic aliases save weeks of refactoring. Used carelessly, they create chains of synonyms that confuse readers and obscure type relationships. The next file (`specification.md`) digs into the formal spec and 1.24 release notes wording.
