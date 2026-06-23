# Generic Type Aliases — Senior Level

## Table of Contents
1. [Identity rules](#identity-rules)
2. [Method sets and the no-methods rule](#method-sets-and-the-no-methods-rule)
3. [Interface satisfaction implications](#interface-satisfaction-implications)
4. [Library re-exports — the architectural lens](#library-re-exports-the-architectural-lens)
5. [Picking alias vs defined type vs wrapper](#picking-alias-vs-defined-type-vs-wrapper)
6. [Embedding and aliases](#embedding-and-aliases)
7. [Reflection on aliased types](#reflection-on-aliased-types)
8. [Common architectural anti-patterns](#common-architectural-anti-patterns)
9. [Summary](#summary)

---

## Identity rules

The single defining property of an alias is **identity preservation**.

```go
type Vec[T any] = []T

var a Vec[int]
var b []int

a = b // OK
b = a // OK
```

This identity is **structural and complete**. `Vec[int]` and `[]int` are the same type at every level the compiler reasons about:

| Level | Result |
|-------|--------|
| Assignability | Same type — no conversion |
| Method set | Same — methods come from the underlying type, none from the alias |
| `reflect.TypeOf` | Returns the underlying type's descriptor |
| Type switches | A case for `Vec[int]` is a case for `[]int` (you cannot have both) |
| Type assertions | `v.(Vec[int])` succeeds iff `v.([]int)` would succeed |

A defined type, in contrast, breaks identity:

```go
type DefVec[T any] []T

var d DefVec[int]
var b []int
b = d // ERROR — different types, conversion needed
```

For a senior engineer, the choice between alias and defined type is fundamentally a question of **identity vs encapsulation**. Aliases preserve the underlying type's identity through the new name; defined types break it.

### When to preserve identity

- **Re-exports** — callers must not need to convert.
- **Migration shims** — old import path still works.
- **Friendly local names** — internal readability without external impact.

### When to break identity

- **Domain modelling** — `Celsius` should not accept any old `float64`.
- **Method attachment** — you can only put methods on a local type.
- **Nominal type safety** — preventing accidental cross-use.

---

## Method sets and the no-methods rule

You cannot declare methods on an alias. The compiler error is:

```
cannot define new methods on non-local type X
```

This rule has been part of Go since aliases were introduced in 1.9 and applies equally to generic aliases in 1.24+.

### Why the rule exists

A method declaration ties a function to a specific named type. If aliases could declare methods, two pieces of code aliasing the same underlying type from different packages could each declare a method with the same name — and the runtime would not know which to dispatch. Forbidding methods on aliases sidesteps the entire problem.

### Practical consequence

When you re-export a generic type, the method set you re-export is **exactly** the method set of the original. You cannot add helpers, you cannot rename methods, you cannot wrap them with logging. If you need any of those, you need a wrapper, not an alias.

```go
package mypkg
import "example.com/bar"

// Re-export — methods come from bar.List as-is
type List[T any] = bar.List[T]

// Need to log on Append? Wrapper required.
type LoggingList[T any] struct {
    bar.List[T]
}
func (l *LoggingList[T]) Append(v T) {
    log.Printf("appending %v", v)
    l.List.Append(v)
}
```

The wrapper is a defined type, not an alias.

---

## Interface satisfaction implications

Because alias preserves identity, it also preserves **all** existing interface satisfaction. If `bar.List[int]` satisfies `Lister[int]`, then `mypkg.List[int]` (an alias) also satisfies `Lister[int]`. Same type, same interfaces.

This is **subtle but important**: a type assertion or type switch in a third package keeps working unchanged after a re-export refactor.

```go
package middleware

func handle(x any) {
    switch v := x.(type) {
    case bar.List[int]:    // matches both bar.List[int] AND mypkg.List[int]
        v.Append(0)
    }
}
```

You cannot write a separate case for `mypkg.List[int]` — the compiler will reject it as a duplicate, because both names refer to the same type.

### Constraint satisfaction

If the underlying type satisfies a constraint, the alias does too:

```go
type IntList = bar.List[int]
// IntList satisfies the same interface and structural constraints as bar.List[int]
```

For generic re-exports across packages, this means callers can use the aliased name **inside** generic functions without changing anything. A constraint that would accept `bar.List[T]` accepts `mypkg.List[T]` as the exact same type.

---

## Library re-exports — the architectural lens

A senior engineer thinks about re-exports in three categories:

### 1. Compatibility shim

Old package, new home, alias bridges them. The shim is a **temporary** structure intended to be removed in a future major version. It should be marked `Deprecated:`.

```go
// Deprecated: use newpkg.Result.
type Result[T any] = newpkg.Result[T]
```

### 2. Curated re-export

Your package is a curated front-end over multiple lower-level packages. You re-export the parts you want public.

```go
package api

type (
    Request[B any]  = transport.Request[B]
    Response[B any] = transport.Response[B]
    Error           = transport.Error
)
```

Callers see `api.Request[T]` and never need to know about `transport`. This is the polite version of "re-export everything from the low-level package".

### 3. Vendored fork

Internal mirror of an upstream library. The alias preserves identity so internal code can mix the upstream's `bar.List[T]` and your fork's `internal/bar.List[T]` freely. (Identity is preserved only if the alias points at the same underlying definition — across forks this requires careful module path management.)

### Architectural rule

A re-export should never introduce **behaviour**. If you find yourself wanting to "just slightly adjust" something, you do not want a re-export — you want a wrapper. Mixing the two is the most common architectural smell.

---

## Picking alias vs defined type vs wrapper

A decision matrix for the three options:

| Goal | Alias | Defined type | Wrapper |
|------|:-----:|:------------:|:-------:|
| Preserve identity | ✓ | ✗ | ✗ |
| Add methods | ✗ | ✓ | ✓ |
| Restrict accepted values | ✗ | ✓ | ✓ |
| Re-export from another package | ✓ | partial | ✗ |
| Add validation / logging | ✗ | partial | ✓ |
| Backwards compatibility | ✓ | ✗ | ✗ |
| Extend an upstream type | ✗ | ✗ | ✓ |
| Document a long type | ✓ | ✓ | ✗ |

The matrix says: **alias for identity, defined type for ownership, wrapper for behaviour**. Mixing them is where most design mistakes happen.

### Worked example

You import `golang-lru/v2`'s `lru.Cache[K, V]`. You want to publish a `mypkg.Cache[K, V]` for your service.

- If you want users to be able to interchange `lru.Cache` and `mypkg.Cache`: **alias**.
- If you want to add `MetricsHook`, `EvictionLogging`, `WithBackoff`: **wrapper** (defined struct embedding `lru.Cache`).
- If you want a renamed type that has no inherited methods (so callers must use your method set): **defined type**.

A senior engineer keeps these three intentions strictly separated.

---

## Embedding and aliases

Aliases of structs can be **embedded** the same way the underlying type can:

```go
type Inner struct{ x int }
type Renamed = Inner

type Outer struct {
    Renamed // embeds Inner — `Outer.x` works
}
```

For generic aliases:

```go
type List[T any] = bar.List[T]

type Container[T any] struct {
    List[T] // embeds bar.List[T]
}
```

The embedded type's methods are promoted to the outer type. This is a useful pattern: **alias + embed** lets a downstream package extend an upstream generic with new methods.

```go
type EnrichedList[T any] struct {
    List[T] // alias of bar.List[T]
}
func (e *EnrichedList[T]) AppendIfNotEmpty(v T) {
    if any(v) != nil {
        e.List.Append(v)
    }
}
```

This combines re-export and extension in a clean way.

---

## Reflection on aliased types

Reflection sees the **underlying** type. The alias name is invisible at runtime.

```go
type Vec[T any] = []T

var v Vec[int]
fmt.Println(reflect.TypeOf(v)) // []int — not Vec[int]
```

Two consequences:

1. **`reflect.TypeOf(x).Name()`** returns the underlying type's name, not the alias.
2. **Two distinct aliases over the same underlying type are indistinguishable at runtime.** Code that branches on the reflected type cannot tell `Vec[int]` from any other alias to `[]int`.

For most generic code this is the correct behaviour — generics already shield you from runtime type-dependent dispatch. But if you are writing a serialization library that expects to see specific named types, aliases do not help.

### Implication for serialization

A type registry keyed by `reflect.Type` will collapse all aliases of the same underlying type into one entry. If you want distinct entries, you need defined types.

---

## Common architectural anti-patterns

### Anti-pattern 1 — Alias-then-extend

```go
type List[T any] = bar.List[T]
func (l List[T]) Custom() { ... } // ERROR: cannot define methods on alias
```

The author wanted "just one extra method". The fix is to switch to embedding:

```go
type List[T any] struct { bar.List[T] }
func (l *List[T]) Custom() { ... }
```

### Anti-pattern 2 — Aliasing for "namespacing"

```go
type Cache[K comparable, V any] = lru.Cache[K, V]
```

Often misused as "I want my package to feel modular". It is fine for re-exports but should not be the primary way you organise your own code.

### Anti-pattern 3 — Stacked aliases

```go
type A[T any] = B[T]
type B[T any] = C[T]
type C[T any] = otherpkg.D[T]
```

The chain compiles but readers must follow three hops to understand what the type really is. Collapse into a single alias.

### Anti-pattern 4 — Constraint laundering

```go
type Loose[T any] = Strict[T] // ❌ constraint mismatch
```

You cannot loosen the constraint via an alias. The compiler will refuse. The temptation to do so usually reveals that the author wants a wrapper, not an alias.

### Anti-pattern 5 — Aliasing through re-exports of re-exports

If `mypkg.List[T] = bar.List[T]` and elsewhere `consumerpkg.List[T] = mypkg.List[T]`, the chain is fine — but every additional layer adds confusion. Stop after one re-export unless you have a specific reason.

### Anti-pattern 6 — Forgetting the deprecation comment

A re-export without `// Deprecated:` looks like a peer name to the canonical type. Readers cannot tell which one is "the real" name. Always document re-exports as deprecation shims when that is the intent.

---

## Summary

Generic aliases are an architectural tool for one job: **preserving type identity across a name change**. They cannot carry methods, they cannot adjust constraints loosely, they cannot transform behaviour. Anything beyond identity preservation belongs to a defined type or a wrapper struct.

A senior engineer considers three orthogonal axes:

1. **Identity** — should the new name be the same type as the old?
2. **Methods** — do I need to attach behaviour locally?
3. **Constraints / validation** — do I need to restrict the type's accepted values?

Identity-only? Alias. Methods or restriction? Defined type or wrapper.

The 1.24 feature is small in syntax and large in design impact: library authors finally have a clean idiom for re-exporting generic types. Used carefully, it makes API migrations a single-line change. Used carelessly, it creates layered name chains that obscure what the underlying types actually are.

Move on to `professional.md` to see how mature projects use generic aliases for real migration work.
