# Generic Pitfalls — Professional Level

## Table of Contents
1. [The professional view](#the-professional-view)
2. [Anti-pattern 1 — Over-generic public APIs](#anti-pattern-1-over-generic-public-apis)
3. [Anti-pattern 2 — `Optional[T]` everywhere](#anti-pattern-2-optionalt-everywhere)
4. [Anti-pattern 3 — Generic wrappers around concrete API surface](#anti-pattern-3-generic-wrappers-around-concrete-api-surface)
5. [Anti-pattern 4 — The "polymorphism by type switch" trap](#anti-pattern-4-the-polymorphism-by-type-switch-trap)
6. [Anti-pattern 5 — Constraint factory explosion](#anti-pattern-5-constraint-factory-explosion)
7. [Anti-pattern 6 — Generic god types](#anti-pattern-6-generic-god-types)
8. [Anti-pattern 7 — Overuse of `any` in generic boundaries](#anti-pattern-7-overuse-of-any-in-generic-boundaries)
9. [Code review heuristics](#code-review-heuristics)
10. [Migration playbooks](#migration-playbooks)
11. [Summary](#summary)

---

## The professional view

A professional Go engineer encounters generics in:

- Open-source libraries written by enthusiastic juniors
- Internal monorepos with mixed adoption
- Migration PRs from `interface{}` to generic
- Code review where the author "made it generic to be reusable"

After reviewing dozens of such codebases, repeating patterns emerge. Each one **compiles**, **passes tests**, and is **published**. Each one is a maintenance liability. The job of a professional reviewer is to recognize them in the diff.

We list seven recurring anti-patterns and the heuristics for catching them.

---

## Anti-pattern 1 — Over-generic public APIs

### The smell

```go
package mylib

func Process[T any, U any, V comparable, F func(T, U) V](f F, t T, u U) V {
    return f(t, u)
}
```

Three type parameters, a function-typed constraint, and a single line of body. The author wanted maximum reusability. The reader gets minimum readability.

### Why it is bad

- godoc renders this as a wall of square brackets
- IDE autocomplete shows the user a long signature with placeholders
- Type inference often fails on real call sites; users must instantiate manually
- Future API changes are hard because every parameter is part of the contract

### The professional fix

Concrete, well-named functions. Generics only where they save real duplication:

```go
func ProcessIntPair(f func(int, int) int, a, b int) int { return f(a, b) }
func ProcessStringPair(f func(string, string) bool, a, b string) bool { return f(a, b) }
```

Or, if there is genuine reuse, **one** type parameter:

```go
func Apply[T any](f func(T, T) T, a, b T) T { return f(a, b) }
```

A senior reviewer asks: *"Could this be written with one type parameter, or zero?"* Most over-generic APIs collapse under that question.

---

## Anti-pattern 2 — `Optional[T]` everywhere

### The smell

```go
type Optional[T any] struct {
    value T
    has   bool
}

func Some[T any](v T) Optional[T] { return Optional[T]{value: v, has: true} }
func None[T any]() Optional[T]    { return Optional[T]{has: false} }
func (o Optional[T]) Get() (T, bool) { return o.value, o.has }
```

Imported from Rust or Scala. The author thought "Go's nilable types are gross; let me give us proper Maybe semantics."

### Why it is bad

- Go has the idiomatic `(T, bool)` return; `Optional[T]` competes with it
- Every API boundary forces conversion: `Optional[T]` to `(T, bool)` and back
- Library users hate it because the signature is non-standard
- Pointer types (`*T`) already carry "may be absent" without a wrapper

### The professional fix

Use Go's existing idioms:

| Need | Idiomatic Go |
|------|--------------|
| Maybe a value | `(T, bool)` |
| Maybe a pointer | `*T` (nil = absent) |
| Typed result with error | `(T, error)` |
| Eager null-coalescing | `cmp.Or` (1.22+) or simple `if` |

If you really want `Optional[T]` because your team comes from a functional language, **localize it** to one package and provide adapters at the boundary:

```go
// internal/option
func From[T any](v T, ok bool) Option[T] { ... }
func (o Option[T]) Tuple() (T, bool) { ... }
```

Do not pollute every public function signature.

---

## Anti-pattern 3 — Generic wrappers around concrete API surface

### The smell

```go
type GenericLogger[T any] struct {
    inner *log.Logger
}

func (l *GenericLogger[T]) Log(v T) { l.inner.Println(v) }
```

The wrapper accepts any `T` and forwards to a concrete logger. The type parameter gives the **caller** a typed surface — but the inside is exactly `interface{}` with extra steps.

### Why it is bad

- The type parameter does not constrain anything; `T` could be anything
- The boxing happens inside `Println`; the generic does not save allocations
- Library users see `GenericLogger[*MyType]` everywhere instead of `*log.Logger`
- Adds no real value over a normal logger

### The professional fix

Either the wrapper actually does something type-specific (then keep it), or it does not (then delete it).

```go
// Either: do something with the type
type TypedLogger[T fmt.Stringer] struct{ ... }
func (l *TypedLogger[T]) Log(v T) {
    l.inner.Printf("[%s] %s", v.Type(), v.String())
}

// Or: just use the original
type Logger = *log.Logger
```

A reviewer flags any generic wrapper whose body is `inner.Foo(v)` for arbitrary `T`.

---

## Anti-pattern 4 — The "polymorphism by type switch" trap

### The smell

```go
func Encode[T any](v T) []byte {
    switch x := any(v).(type) {
    case string:
        return []byte(x)
    case int:
        return []byte(strconv.Itoa(x))
    case fmt.Stringer:
        return []byte(x.String())
    }
    panic("unsupported type")
}
```

Generic syntax masking interface-style polymorphism. The compile-time type parameter `T` is replaced at runtime by a `switch` — so the generics do nothing useful.

### Why it is bad

- The compiler cannot help when a caller adds a new type
- Adding a case requires editing the function (open/closed violated)
- `panic("unsupported")` ships unsafe defaults
- Performance is no better than `func Encode(v interface{}) []byte`

### The professional fix

Use a real interface:

```go
type Encoder interface { Encode() []byte }

func Encode(e Encoder) []byte { return e.Encode() }
```

Each type implements `Encode` differently. Adding a new type is a new method, not a code edit. Compiler enforces the contract.

If you want both — concrete primitives **and** user types — combine:

```go
type Encoder interface { Encode() []byte }

func Encode(v any) []byte {
    if e, ok := v.(Encoder); ok { return e.Encode() }
    // primitive fast paths
    switch x := v.(type) {
    case string: return []byte(x)
    case int:    return []byte(strconv.Itoa(x))
    }
    panic("unsupported type")
}
```

Note this version is **not generic**. The "generic" version was hiding interface dispatch behind generic syntax.

---

## Anti-pattern 5 — Constraint factory explosion

### The smell

```go
package constraints

type Integer interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}
type Float interface { ~float32 | ~float64 }
type Number interface { Integer | Float }
type Ordered interface { Number | ~string }
type Equatable[T any] interface { Equal(T) bool }
type Cloneable[T any] interface { Clone() T }
type Mergeable[T any] interface { Merge(T) T }
type SerializableJSON interface { json.Marshaler; json.Unmarshaler }
// ... thirty more constraints
```

Every internal helper grows its own one-off constraint. Six months later the package has 30 constraints, half of them satisfied by zero types.

### Why it is bad

- godoc bloat
- Each constraint imposes a small cognitive tax
- Many overlap or duplicate stdlib `cmp.Ordered`
- The half that are satisfied by zero types are dead code

### The professional fix

Adopt a **constraint inventory rule**:

1. Use `cmp.Ordered` from stdlib first.
2. Use `comparable` from the language second.
3. Use a custom constraint **only** when at least three call sites need it.
4. Constraints with method requirements live in the **same package** as the helpers that use them.

Audit constraints quarterly. Delete unused ones.

---

## Anti-pattern 6 — Generic god types

### The smell

```go
type Pipeline[T, U, V, W any] struct {
    transform1 func(T) U
    transform2 func(U) V
    transform3 func(V) W
    onError    func(error)
    metrics    Metrics
    tracer     Tracer
}
```

Five type parameters. Three transforms hard-coded. The author wanted a "fully generic pipeline".

### Why it is bad

- Inference is impossible at the call site
- Adding a fourth transform requires a new type with six type parameters
- The signature dominates godoc
- Each instantiation costs build time

### The professional fix

Compose simple binary pipelines:

```go
type Step[T, U any] func(T) U

func Chain[T, U, V any](a Step[T, U], b Step[U, V]) Step[T, V] {
    return func(t T) V { return b(a(t)) }
}
```

Two type parameters per step. Composition extends naturally:

```go
pipe := Chain(parse, Chain(validate, transform))
```

Each `Chain` call has manageable inference. The user can build arbitrarily long pipelines without ever having a five-parameter type.

---

## Anti-pattern 7 — Overuse of `any` in generic boundaries

### The smell

```go
func Process[T any](v T) any {
    return doSomething(v)
}
```

The function takes a typed `T`, returns `any`. The caller has to cast on the way out. The `T` parameter does nothing useful; it is decoration.

### Why it is bad

- Defeats the purpose of generics
- Caller sees `any` and must assert
- Compile-time safety is lost
- Reads as "I gave up on generics"

### The professional fix

Either commit to generics or don't:

```go
// Committed
func Process[T any, R any](v T, fn func(T) R) R { return fn(v) }

// Not committed — fine, just don't pretend
func Process(v any) any { return doSomething(v) }
```

A reviewer asks: *"What is `T` doing here?"* If the answer is "just decorating the parameter", remove the generic.

---

## Code review heuristics

A short checklist for reviewing generic Go code:

### Heuristic 1 — Type parameter density

Count type parameters per signature:
- 0 — fine
- 1 — fine
- 2 — usually fine (`K, V`)
- 3+ — challenge it

### Heuristic 2 — Body uses each parameter

Verify that **every** type parameter appears in the body in a way that uses its constraint. If `T` only flows through, the parameter is decorative.

### Heuristic 3 — Constraint matches operations

Read the body. List every operation on `T` (`==`, `<`, `+`, method calls). Verify the constraint **exactly** allows those — no more, no less.

### Heuristic 4 — Public vs internal

Generic public APIs are expensive to change. Generic internal helpers are cheap. Reviewers should be more permissive in `internal/` and stricter at the package boundary.

### Heuristic 5 — Type switch on `T`

Any `switch any(v).(type)` is a yellow flag. Ask: would an interface be cleaner? Often yes.

### Heuristic 6 — Method on `*T` vs `T`

If the constraint requires a method, verify which receiver type the user expects to satisfy it. Document explicitly.

### Heuristic 7 — Zero-value handling

Search for `var zero T` or `*new(T)`. Verify each return-of-zero corresponds to a real "empty" semantics, not a bug.

### Heuristic 8 — Reflection inside generic body

Reflection inside a generic function is a yellow flag. Ask: would interface{} be more honest?

### Heuristic 9 — Cross-package ownership

If a generic is **defined** in one package and instantiated in many others, ask whether the build-cache impact is acceptable. Most of the time yes; for hot CI paths, possibly no.

### Heuristic 10 — Constraint package size

Watch for constraint files that grow unboundedly. Apply the "rule of three" before adding a constraint.

---

## Migration playbooks

### Playbook A — Migrating `interface{}` helpers to generic

1. Identify the helper (`func Contains(s []interface{}, target interface{}) bool`).
2. Add a generic equivalent **alongside** with a new name (`ContainsT`).
3. Mark the old one `// Deprecated:`.
4. Migrate callers as they are touched.
5. After a major version bump, remove the old.

Avoid silently changing behaviour. The new and old must agree on edge cases (empty slice, nil target) before deprecation.

### Playbook B — Tightening a constraint

1. Audit current callers to see which type arguments they use.
2. Verify every existing caller satisfies the tighter constraint.
3. Tighten in a major version bump.
4. Document in the changelog as a breaking change even if no caller actually breaks.

Tightening looks safe. It is not. Future callers might have used the loose form.

### Playbook C — Loosening a constraint

1. Verify every operation in the body still compiles under the looser constraint.
2. Add new tests with types that satisfy the new but not the old constraint.
3. Loosening is usually backwards-compatible, but be aware of inference shifts.

### Playbook D — Removing a generic helper

1. Verify no public callers exist.
2. If public callers exist, deprecate first; remove only after a deprecation cycle.
3. Even internal helpers should be removed in a separate PR for git-bisect friendliness.

---

## Summary

A professional Go reviewer reads generic code with a different lens than non-generic code. The seven anti-patterns above account for the majority of "this looked good but aged poorly" cases:

1. Over-generic public APIs
2. `Optional[T]` everywhere
3. Generic wrappers without value
4. Polymorphism by type switch
5. Constraint factory explosion
6. Generic god types
7. `any` at generic boundaries

The ten review heuristics provide a checklist that fits in your head. The four migration playbooks cover the most common evolution paths. Generic Go code is mostly fine — the standard library's `slices`, `maps`, and `cmp` packages are the canonical models — but the long tail of community code is dotted with these traps.

A professional engineer **does not** prevent generics from being used. They prevent generics from being used **inappropriately**. The next file digs into the spec excerpts that explain *why* each of these patterns is the way it is.
