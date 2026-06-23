# Generic Type Aliases — Middle Level

## Table of Contents
1. [The pre-1.24 gap](#the-pre-124-gap)
2. [Workarounds you actually saw in the wild](#workarounds-you-actually-saw-in-the-wild)
3. [The compatibility window: GOEXPERIMENT=aliastypeparams](#the-compatibility-window-goexperimentaliastypeparams)
4. [Migration patterns](#migration-patterns)
5. [Identity vs equivalence — re-explained](#identity-vs-equivalence-re-explained)
6. [Aliases and the type checker](#aliases-and-the-type-checker)
7. [Constraint propagation](#constraint-propagation)
8. [Tooling readiness](#tooling-readiness)
9. [Summary](#summary)

---

## The pre-1.24 gap

Generics shipped in **March 2022** (Go 1.18). Type aliases shipped in **August 2017** (Go 1.9). For roughly three years they coexisted without overlap. The original generics design explicitly forbade aliases from having type parameters:

> A type alias declaration may not introduce type parameters.

This was a known TODO. The 1.18 team prioritised getting the core feature out and listed parameterised aliases as future work in [issue 46477](https://github.com/golang/go/issues/46477). The restriction made one specific task awkward: **re-exporting** a generic type from another package without changing its identity.

### Why it mattered

Suppose package `bar` defines:

```go
package bar

type List[T any] struct { data []T }
func (l *List[T]) Append(v T) { l.data = append(l.data, v) }
```

Now your package wants to publish `mypkg.List` as the canonical name while the implementation still lives in `bar`. Three options were available pre-1.24:

1. **Defined type pointing at the same underlying** — `type List[T any] bar.List[T]`. New identity, no methods inherited.
2. **Wrapper with explicit forwarding** — write a struct with a field of type `bar.List[T]` and forward every method.
3. **Generated code** — emit the wrappers from a tool.

All three changed the externally observable type. A function expecting `bar.List[int]` would refuse `mypkg.List[int]` without a conversion. Backwards compatibility was lost.

### What 1.24 changed

A single grammatical change in the spec:

> Type alias declarations may have type parameters.

That is the entire feature, syntactically. Semantically, it preserves identity: `mypkg.List[int]` and `bar.List[int]` become the **same** type once the alias is in place.

---

## Workarounds you actually saw in the wild

### Workaround 1 — Defined type with method forwarding

```go
// pkg/mypkg/list.go (pre-1.24)
package mypkg

import "example.com/bar"

type List[T any] struct {
    inner bar.List[T]
}

func (l *List[T]) Append(v T) { l.inner.Append(v) }
// ... and so on for every method
```

Tedious, error-prone, and changes the type identity. Adding a new method to `bar.List` did not propagate to `mypkg.List` — every release you had to keep the wrapper in sync.

### Workaround 2 — Type definition with the same underlying

```go
package mypkg
type List[T any] bar.List[T]
```

Compiles. But `mypkg.List` has no methods (defined type does not inherit), so calling `Append` requires a conversion: `(*bar.List[int])(&l).Append(...)`. Every caller has to know about the conversion. Hostile API.

### Workaround 3 — Helper function

Sometimes the goal was not really re-export but "give my callers an easier name":

```go
type List[T any] = bar.List // ❌ pre-1.24 — alias cannot have type params
```

Workaround:

```go
func MakeList[T any]() *bar.List[T] { return &bar.List[T]{} }
```

Constructor only. The user still refers to `bar.List[T]`, which leaks the source package name everywhere.

### Workaround 4 — Code generation

`go generate` plus a template: emit a per-T concrete type. Worked, but defeated the point of generics — you ended up with one type per `T`, which is exactly what generics were supposed to remove.

### Why all of these felt awkward

Each workaround broke at least one of:

- Identity preservation
- Method visibility
- Backwards compatibility

Generic aliases were the one tool that could satisfy all three at once.

---

## The compatibility window: GOEXPERIMENT=aliastypeparams

The Go team prototyped generic aliases behind an experiment flag before making them default.

### Timeline

| Release | Date | Status |
|---------|------|--------|
| 1.22 | Feb 2024 | First experimental support behind `GOEXPERIMENT=aliastypeparams` |
| 1.23 | Aug 2024 | Still experimental, more bug fixes |
| **1.24** | **Feb 2025** | **Default — no flag needed** |

So a Go 1.22 user could write:

```bash
GOEXPERIMENT=aliastypeparams go build ./...
```

and the toolchain would accept `type Vec[T any] = []T`. Without the flag, the compiler rejected it.

### What this meant for libraries

Libraries that wanted to be **forward-compatible** in 1.22 / 1.23 had to keep the workaround in their main branch and put generic aliases behind a build tag, e.g.:

```go
//go:build goexperiment.aliastypeparams

package mypkg
type List[T any] = bar.List[T]
```

Most projects skipped this and waited for 1.24. The experiment flag mainly served the standard library and a handful of early adopters.

### Reading old code

If you encounter:

```go
//go:build goexperiment.aliastypeparams
type Foo[T any] = otherpkg.Foo[T]
```

…in a library predating 1.24, that build tag is now a no-op. The file compiles unconditionally on 1.24+. You can usually delete the tag during cleanup.

---

## Migration patterns

Three idiomatic patterns have emerged for migrating to generic aliases.

### Pattern 1 — In-place re-export

The simplest. The type stays in package `bar`; package `mypkg` just adds an alias.

```go
package mypkg
import "example.com/bar"

// List is a re-export of bar.List for backwards compatibility.
// New code should import bar directly.
//
// Deprecated: use bar.List.
type List[T any] = bar.List[T]
```

Old callers using `mypkg.List[int]` keep working. New callers move to `bar.List[int]` at their own pace.

### Pattern 2 — Move the type

The reverse case. The type **was** in `mypkg`, and you want to move it to `bar`. Old callers keep using `mypkg.List`; the alias forwards to the new home.

```go
// pkg/bar (new home)
package bar
type List[T any] struct { data []T }

// pkg/mypkg (old home, now a thin shim)
package mypkg
import "example.com/bar"
type List[T any] = bar.List[T]
```

After two releases, you can deprecate `mypkg.List` and eventually delete it.

### Pattern 3 — Major version split

Hashicorp-style: ship `mypkg/v2` with the new home and leave `mypkg/v1` alive. Generic aliases inside the v2 module make the migration smoother because v2 can re-export v1's types when convenient — though for fully separate identities you usually want a defined type, not an alias.

### Anti-patterns

- **Aliasing without a deprecation comment** — readers cannot tell whether the alias is the canonical name or a temporary shim.
- **Aliasing across module boundaries with cyclic imports** — generic aliases must follow the same import cycle rules as any other declaration.
- **Aliasing a type then trying to add methods to it** — does not work; you need a defined type.
- **Aliases that change the constraint** — `type Foo[T any] = bar.Foo[T]` when `bar.Foo` requires `comparable` is a compile error.

---

## Identity vs equivalence — re-explained

The Go spec distinguishes:

- **Type identity** — two types are "the same" type for assignability purposes.
- **Type equivalence** — looser; structural similarity.

Aliases preserve identity. Defined types break it (they share an underlying type but are not identical).

```go
type AliasVec[T any] = []T
type DefinedVec[T any] []T

var a AliasVec[int]   = []int{1}
var d DefinedVec[int] = []int{1}

var s []int
s = a // OK — same type
s = d // ERROR — DefinedVec[int] is not []int (it has []int as underlying)
s = []int(d) // OK with conversion
```

Generic aliases extend this: `Foo[T] = Bar[T]` means `Foo[X]` and `Bar[X]` are identical for every concrete `X`.

### Why this is the whole point

Library authors want to say: "Here is my package, but the type already lives somewhere else, and I do not want callers to convert anything." Aliases are the only tool that says exactly that.

A defined type would force callers to convert at every boundary. A wrapper struct would force them to access an inner field. An alias just **is** the other type.

---

## Aliases and the type checker

When the compiler sees:

```go
type Vec[T any] = []T

func Sum(v Vec[int]) int { ... }
```

It does the following internally:

1. Parse the alias declaration — record `Vec` as a parameterised alias for `[]T`.
2. When type-checking `Vec[int]`, substitute `T = int` into the right-hand side, yielding `[]int`.
3. Use `[]int` everywhere the alias appears.

There is no runtime data structure for "the alias `Vec`". After type checking, only `[]int` exists in the IR.

### Implication for error messages

Errors usually report the **expanded** type, not the alias name. A mismatch between `Vec[int]` and `[]string` may print:

```
cannot use x (variable of type []int) as []string
```

The alias does not appear. This is intentional — the compiler reasons in terms of the underlying type. Modern `gopls` versions sometimes preserve the alias name for hover / inlay hints.

---

## Constraint propagation

A generic alias declares its own type parameter list, and constraints must be **at least as strict** as those of the right-hand side.

### Example: matching constraints

```go
package bar
type Set[T comparable] struct{ m map[T]struct{} }

package mypkg
import "example.com/bar"

type Set[T comparable] = bar.Set[T] // OK
```

If you try a looser constraint:

```go
type Set[T any] = bar.Set[T] // ERROR: T does not satisfy comparable
```

…the compiler refuses because `mypkg.Set[T]` claims to accept all types but `bar.Set[T]` requires `comparable`.

### Example: tighter constraints

You can be **stricter** than the original:

```go
type IntSet = bar.Set[int] // fully specialised — no parameters
```

Or with a tighter constraint:

```go
type StringKeyMap[V any] = map[string]V // no constraint needed; alias to a concrete map
```

The general rule: the alias must accept a subset of types that the right-hand side accepts.

---

## Tooling readiness

Tools needed updates to recognize parameterised aliases:

| Tool | Status as of mid-2025 |
|------|-----------------------|
| `gofmt` | Default in 1.24 |
| `go vet` | Default in 1.24 |
| `gopls` | Mostly OK in 1.24; older versions show parse errors |
| `staticcheck` | Updated 2025-Q1 to recognise the new form |
| `golangci-lint` | Bundled with updated `gopls` in 2025 releases |
| GoLand | Supported in 2025.1+ |
| VS Code Go extension | Tracks `gopls`, fixed in 2025-Q1 |

If you adopt generic aliases, **bump your IDE and linter** at the same time. Older tools will report syntax errors on perfectly valid code.

### CI considerations

A typical CI pipeline must:

1. Use Go 1.24 or newer in all build jobs.
2. Update `golangci-lint` to a release that supports parameterised aliases.
3. Re-cache `gopls` in any container-based dev environments.
4. Update `go.mod`'s `go` directive to `1.24`.

---

## Summary

Generic type aliases were the last loose end of Go's generics design. From 1.18 to 1.23, library authors who wanted to **re-export** a generic type were stuck with awkward workarounds: defined types that broke identity, wrapper structs with method forwarding, or code generators. None preserved the property "my callers do not need to convert anything".

Go 1.22 introduced `GOEXPERIMENT=aliastypeparams` as an opt-in. Go 1.24 made it default. Nothing about runtime changed — generic aliases erase to their underlying type before code generation, just like non-generic aliases always have.

The migration patterns are simple: in-place re-export, move-the-type, or major-version split. In all cases the alias preserves identity, so callers continue compiling without modification.

Tooling caught up in late 2024 / early 2025. Today, using generic aliases is as routine as using any other generics feature — provided you are on 1.24 or later.

Move on to `senior.md` to see how identity rules and method-set restrictions shape architectural decisions.
