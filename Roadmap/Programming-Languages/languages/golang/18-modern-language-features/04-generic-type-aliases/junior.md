# Generic Type Aliases — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a type alias?" and "What does it mean to give one type parameters?"

Go has had *type aliases* since Go 1.9. You write

```go
type Bytes = []byte
```

and from then on `Bytes` and `[]byte` are **the same type** — not two related types, the same one. The `=` is the giveaway: an alias is a second spelling for an existing type, like a nickname.

What Go 1.24 adds is the ability to put **type parameters** on that nickname:

```go
type Set[T comparable] = map[T]struct{}
```

Now `Set` is a *generic* alias. You instantiate it like any generic type — `Set[string]`, `Set[int]` — and each instantiation is just a shorter way to write the underlying map type. `Set[int]` *is* `map[int]struct{}`. Not "behaves like." *Is.*

This file teaches the one idea behind that line and the rules that fall out of it. After reading you will:

- Know the difference between an *alias* (`type A = B`) and a *defined type* (`type A B`)
- Understand what `type Set[T] = ...` produces and how `Set[string]` is resolved
- Be able to predict when two generic-alias types are identical
- Know that you **cannot** put methods on an alias
- Know which Go version you need (1.24) and why earlier ones did not allow this

You do **not** need to understand the type-inference algorithm, constraint satisfiability, or the compiler internals yet. This file is about the moment you write `type Pair[A, B any] = struct{ First A; Second B }` and want to know exactly what you just declared.

---

## Prerequisites

- **Required:** Go 1.24 or newer. Generic type aliases became fully supported, on by default, in Go 1.24. Check with `go version`. (They were available behind `GOEXPERIMENT=aliastypeparams` in 1.23, but do not rely on that.)
- **Required:** Familiarity with Go generics — type parameters, constraints like `any` and `comparable`, and instantiation (`Stack[int]`). See [18.1 Generics Basics](../01-generics-basics/junior.md) if those are new.
- **Required:** Knowing what a plain (non-generic) type alias is: `type Celsius = float64`.
- **Helpful:** Knowing the difference between a *defined type* and its *underlying type*.
- **Helpful:** Having written at least one generic function or generic struct of your own.

If `go version` prints `go1.24` or higher and `go build` accepts `type Set[T comparable] = map[T]struct{}`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type alias** | A declaration using `=` (`type A = B`) that makes `A` an alternate name for the *same* type `B`. No new type is created. |
| **Defined type** (named type) | A declaration without `=` (`type A B`) that creates a *new, distinct* type whose underlying type is `B`. |
| **Generic type alias** | A type alias that takes type parameters: `type Set[T comparable] = map[T]struct{}`. New in Go 1.24. |
| **Type parameter** | A placeholder type in brackets: the `T` in `Set[T comparable]`. |
| **Constraint** | The interface after a type parameter that restricts what types may be substituted: `comparable`, `any`, etc. |
| **Instantiation** | Supplying concrete type arguments: `Set[string]` instantiates `Set` with `T = string`. |
| **Identical types** | Two types the compiler treats as the same. `Set[int]` is identical to `map[int]struct{}`. |
| **Underlying type** | The structural type a defined type is built on. For `type Meters float64`, the underlying type is `float64`. |
| **Right-hand side (RHS)** | The type on the right of `=` in an alias. For `type Set[T] = map[T]struct{}`, the RHS is `map[T]struct{}`. |

---

## Core Concepts

### An alias is the *same* type; a defined type is a *new* type

This is the whole foundation. Compare:

```go
type AliasBytes   = []byte   // alias:        AliasBytes IS []byte
type DefinedBytes []byte     // defined type: DefinedBytes is a NEW type
```

- `AliasBytes` is interchangeable with `[]byte` everywhere. You can pass an `AliasBytes` to a function expecting `[]byte` with no conversion.
- `DefinedBytes` is its own type. You must convert (`[]byte(x)`) to pass it where `[]byte` is expected, and you *can* attach methods to it.

The `=` sign is the difference between "another name for" and "a brand-new type based on."

### Adding type parameters to an alias

Before Go 1.24 the left side of an alias could not have brackets. Now it can:

```go
type Set[T comparable] = map[T]struct{}
type Pair[A, B any]    = struct {
    First  A
    Second B
}
type Result[T any]     = struct {
    Value T
    Err   error
}
```

Each of these is an alias whose RHS *mentions the type parameters*. Reading `Set[T comparable] = map[T]struct{}` aloud: "`Set` of `T` (where `T` is comparable) is another name for `map[T]struct{}`."

### Instantiation just substitutes and resolves to the RHS

When you write `Set[string]`, the compiler substitutes `string` for `T` in the RHS:

```
Set[string]  →  map[string]struct{}
Pair[int, string]  →  struct{ First int; Second string }
```

So `Set[string]` is literally `map[string]struct{}`. There is no new type sitting in between. This is the defining property of a generic alias.

### The constraint is checked on the alias's parameter

`Set[T comparable]` says `T` must satisfy `comparable`. If you write `Set[[]int]`, you get a compile error, because slices are not comparable and so cannot be map keys:

```go
type Set[T comparable] = map[T]struct{}

var ok  Set[string]  // fine
var bad Set[[]int]   // error: []int does not satisfy comparable
```

The constraint lives on the alias and is enforced at instantiation, exactly as for a generic defined type.

### You cannot declare methods on an alias

Because an alias is not a new type, there is nothing to attach a method *to*. This is illegal:

```go
type Set[T comparable] = map[T]struct{}

func (s Set[T]) Add(v T) { s[v] = struct{}{} } // ERROR: cannot define methods on alias type
```

If you want methods, you need a *defined* generic type instead:

```go
type Set[T comparable] map[T]struct{}            // defined type, no '='
func (s Set[T]) Add(v T) { s[v] = struct{}{} }   // now legal
```

Remember the trade: alias = transparent, no methods; defined type = new type, can have methods, needs conversions.

### Identity is transparent through the alias

Two values whose types resolve to the same RHS are the same type:

```go
type Set[T comparable] = map[T]struct{}

var a Set[int]
var b map[int]struct{}
a = b // fine — identical types, no conversion needed
b = a // also fine
```

That transparency is the entire reason generic aliases are useful: you can introduce a friendly name without forcing callers to convert.

---

## Real-World Analogies

**1. A nickname, not a clone.** "Bob" is a nickname for "Robert." It is not a different person — every message to Bob reaches Robert. A type alias is a nickname for a type. `Set[T]` is a nickname for `map[T]struct{}`; mail sent to either arrives at the same place. A *defined type* would be a different person who happens to look like Robert.

**2. A shortcut on your desktop.** A desktop shortcut to `/Applications/Editor.app` is not a second copy of the app — double-clicking it launches the very same program. `type Editor = realpkg.BigConfigStruct` is a shortcut; using it uses the real thing. Generic aliases let the shortcut itself take a parameter: "shortcut to the *editor configured for language X*."

**3. A translated label on the same jar.** Put an English label and a French label on one jam jar. Two labels, one jar. `Set[int]` and `map[int]struct{}` are two labels on the same jar of jam.

**4. A form template with blanks.** `type Pair[A, B any] = struct{ First A; Second B }` is a form with two blanks. Fill in `A=int, B=string` and you get a concrete, ordinary struct — there is no "Pair object" wrapping it, just the filled-in form.

---

## Mental Models

### Model 1 — `=` means "is," no `=` means "new"

`type A = B` ⇒ A *is* B. `type A B` ⇒ A is a *new type built on* B. Carry this one symbol everywhere.

### Model 2 — A generic alias is a *type-level template*

It is a recipe that takes types and produces a type. Feed in `string`, get `map[string]struct{}` back. The recipe itself is not a runtime thing; it is resolved entirely by the compiler.

### Model 3 — Instantiate, then substitute, then forget the alias

When the compiler sees `Set[string]`, it (1) checks `string` satisfies `comparable`, (2) substitutes `string` into the RHS, (3) produces `map[string]struct{}`. From step 3 on, the alias name plays no further role in type identity.

### Model 4 — No new type ⇒ no methods, no encapsulation

Because nothing new exists, an alias gives you naming and nothing else: no method set of its own, no privacy boundary. If you need behavior or encapsulation, reach for a defined type.

### Model 5 — Transparency is the feature *and* the limitation

The fact that `Set[int]` *is* `map[int]struct{}` is exactly what makes aliases great for re-exporting and migration — and exactly why they cannot give you a distinct type with its own methods.

---

## Pros & Cons

### Pros

- **Shorter names for verbose generic types.** `Pair[A, B]` reads better than `struct{ First A; Second B }` repeated everywhere.
- **Zero-cost transparency.** No conversions: an alias value flows freely where the RHS is expected.
- **Safe re-exporting.** A package can re-export another package's generic type under a local name *without* creating an incompatible type (covered in senior.md).
- **Gradual migration.** You can move a generic type to a new package and leave an alias behind so old import paths keep compiling.
- **Familiar mechanics.** Instantiation and constraints work exactly as they do for generic defined types.

### Cons

- **No methods.** You cannot attach behavior to an alias. Period.
- **No encapsulation.** An alias does not create a privacy boundary; callers see straight through to the RHS.
- **Requires Go 1.24+.** Earlier toolchains reject the syntax (or hide it behind an experiment flag in 1.23).
- **Can hide complexity.** A friendly name like `Set[T]` may obscure that you are really passing a raw map around with no invariants enforced.

---

## Use Cases

Reach for a generic type alias when:

- **You repeat a verbose generic type literal** and want one readable name: `type Handler[T any] = func(context.Context, T) error`.
- **You want to re-export a generic type** from another package under a new path without breaking callers' type identity.
- **You are migrating an API** and need old and new names to refer to the *same* type during the transition.
- **You want a domain-friendly synonym** for a standard container: `type Set[T comparable] = map[T]struct{}`.
- **You want to shorten a constraint-heavy signature** by naming the common shape once.

Do **not** reach for one when:

- You need **methods** on the type — use a defined generic type.
- You need a **distinct type** the compiler will keep separate (to prevent mixing units, enforce invariants) — use a defined type.
- You target a toolchain **older than Go 1.24** without the experiment flag.

---

## Code Examples

### Example 1 — A `Set` alias

```go
package main

import "fmt"

type Set[T comparable] = map[T]struct{}

func main() {
    s := Set[string]{}      // same as map[string]struct{}{}
    s["a"] = struct{}{}
    s["b"] = struct{}{}

    _, has := s["a"]
    fmt.Println("has a:", has)        // has a: true
    fmt.Println("size:", len(s))      // size: 2

    // Transparency: assign to the underlying map type, no conversion.
    var m map[string]struct{} = s
    fmt.Println("m == s identity holds:", len(m) == len(s))
}
```

`Set[string]` is just `map[string]struct{}`, so all the usual map operations work and the assignment to `m` needs no cast.

### Example 2 — A `Pair` alias

```go
type Pair[A, B any] = struct {
    First  A
    Second B
}

func main() {
    p := Pair[int, string]{First: 1, Second: "one"}
    fmt.Println(p.First, p.Second) // 1 one

    // It IS an anonymous struct, so this is identical:
    var q struct {
        First  int
        Second string
    } = p // no conversion needed
    _ = q
}
```

### Example 3 — Alias vs defined type, side by side

```go
type SetAlias[T comparable]   = map[T]struct{}   // alias: same type
type SetDefined[T comparable] map[T]struct{}      // defined: new type

func main() {
    var a SetAlias[int]   = map[int]struct{}{} // OK: identical types
    var b SetDefined[int] = map[int]struct{}{} // OK too: assignment from underlying literal allowed

    var m map[int]struct{}
    m = a // OK: a is a map[int]struct{}
    // m = b // ERROR: SetDefined[int] is a distinct type, needs conversion
    m = map[int]struct{}(b) // explicit conversion required
    _ = m
}
```

### Example 4 — A constraint error you can trigger

```go
type Set[T comparable] = map[T]struct{}

func main() {
    var ok  Set[string] // fine
    var bad Set[[]byte] // compile error: []byte does not satisfy comparable
    _, _ = ok, bad
}
```

Slices are not comparable, so they cannot be the key type of a map — the constraint catches it at compile time.

### Example 5 — A function-type alias

```go
type Middleware[T any] = func(next func(T)) func(T)

func logging[T any](next func(T)) func(T) {
    return func(v T) {
        fmt.Println("before")
        next(v)
        fmt.Println("after")
    }
}

func main() {
    var mw Middleware[string] = logging[string]
    mw(func(s string) { fmt.Println("handle:", s) })("hi")
}
```

`Middleware[string]` is identical to `func(next func(string)) func(string)` — the alias just spares you from writing that twice.

---

## Coding Patterns

### Pattern: name your container shape once

```go
type ByID[T any]   = map[string]T
type Slice2D[T any] = [][]T

func loadUsers() ByID[User] { /* ... */ return nil }
```

The function signature reads `ByID[User]` instead of `map[string]User` — clearer at the call site.

### Pattern: alias a verbose callback type

```go
type Handler[Req, Res any] = func(context.Context, Req) (Res, error)

func register[Req, Res any](path string, h Handler[Req, Res]) { /* ... */ }
```

### Pattern: choose alias *or* defined type deliberately

```go
// Want behavior? Defined type.
type OrderedSet[T cmp.Ordered] map[T]struct{}
func (s OrderedSet[T]) Sorted() []T { /* ... */ return nil }

// Want a transparent shortcut? Alias.
type Lookup[T any] = map[string]T
```

Ask: "Do I need methods or a distinct type?" Yes → defined type. No → alias.

---

## Clean Code

- **Use an alias only for naming**, not to pretend you have a new abstraction. If you find yourself wishing it had a method, switch to a defined type.
- **Keep the RHS readable.** `type Pair[A, B any] = struct{ First A; Second B }` is fine; a five-level nested generic RHS hidden behind a short name is a trap.
- **Document the alias** with a one-line comment stating it is *the same type* as its RHS, so readers do not assume it is distinct.
- **Match constraints to the RHS.** `Set[T comparable]` must use `comparable` because `map[T]...` requires comparable keys. A looser constraint will not even compile.
- **Do not alias just to save five characters.** A name earns its place only if it clarifies intent.

---

## Product Use / Feature

In a real codebase, generic aliases mostly serve readability and migration:

- **API ergonomics.** A library exposes `type Option[T any] = func(*config[T])` so callers write `Option[Server]` instead of a long functional-options signature.
- **Package moves.** When `pkg/oldhome` becomes `pkg/newhome`, you leave `type Widget[T any] = newhome.Widget[T]` behind. Old code keeps compiling; the types are identical, so nothing breaks.
- **Domain vocabulary.** `type UserSet = Set[UserID]` (a non-generic alias of a generic instantiation) gives your domain a precise word.

The feature is small but it removes a real papercut: before 1.24, re-exporting a generic type required a wrapper defined type, which broke identity and forced conversions.

---

## Error Handling

Errors with generic aliases are almost all **compile-time**, which is the good kind.

### "cannot use generic type ... without instantiation"

You used the alias name without supplying type arguments:

```go
var s Set // ERROR: Set requires type arguments, e.g. Set[string]
```

Fix: instantiate it — `var s Set[string]`.

### "T does not satisfy comparable"

You instantiated with a type that violates the constraint:

```go
var bad Set[[]int] // ERROR
```

Fix: use a type that satisfies the constraint, or change the alias's constraint if the RHS allows it.

### "cannot define new methods on ... alias type"

You tried to attach a method to an alias. Fix: convert the alias into a *defined* type (drop the `=`).

### "undefined: ... (requires go1.24 or later)"

Your toolchain is too old. Fix: upgrade to Go 1.24, or bump the `go` directive in `go.mod` to `go 1.24`.

There is no special runtime error handling for aliases — at runtime, a `Set[int]` simply *is* a `map[int]struct{}` and behaves exactly like one.

---

## Security Considerations

- **No new attack surface.** A generic alias compiles to its RHS; it does not introduce reflection, code generation, or runtime indirection. `Set[int]` is a map at runtime, nothing more.
- **Transparency can leak invariants.** Because an alias has no methods and no privacy boundary, you cannot use it to *enforce* a validated state. If you need "this map is always non-nil and keys are validated," that is a job for a defined type with constructor and methods, not an alias.
- **Re-exporting stays type-safe.** Aliasing another package's generic type does not bypass that package's `internal/` rules or unexported fields; the alias only renames the type, it does not grant new access.
- **No conversion holes.** Since aliased values are *identical* to the RHS, there is no unsafe conversion involved — the compiler never inserts a cast.

---

## Performance Tips

- **Zero runtime cost.** A generic alias is resolved entirely at compile time. There is no wrapper, no allocation, no indirection. `Set[int]` performs exactly like `map[int]struct{}`.
- **No extra instantiation overhead vs the RHS.** Aliasing does not add another layer of generic instantiation; the compiler resolves straight to the underlying type.
- **Choose `struct{}` map values for sets.** The classic `map[T]struct{}` (which the alias names) uses zero bytes per value — better than `map[T]bool`. The alias just makes that idiom readable.
- **Aliases do not change escape analysis or inlining.** Whatever the RHS would do, the alias does identically.

The honest summary: there is nothing to optimize *about* the alias mechanism; it is free. The optimization work is in choosing the right underlying type, which the alias merely names.

---

## Best Practices

1. **Use `=` only when you truly want the same type.** If you want a new type, drop the `=`.
2. **Reach for a defined type the moment you need a method.** Aliases cannot have them.
3. **Keep the constraint consistent with the RHS.** `map` keys need `comparable`; honor that.
4. **Document an alias as "same type as <RHS>"** so readers do not over-assume.
5. **Prefer aliases for re-export and migration**, where preserving type identity is the whole point.
6. **Do not nest aliases deeply.** An alias of an alias of an alias is legal but hard to read; aim for one hop.
7. **Pin `go 1.24` in `go.mod`** so contributors get a clear version error rather than a confusing syntax error.
8. **Name for the reader.** `Handler[Req, Res]` earns its keep; `M[T] = map[string]T` named `M` does not.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Expecting methods to work

```go
type Set[T comparable] = map[T]struct{}
func (s Set[T]) Add(v T) {} // does not compile
```

Aliases have no method set of their own. Use a defined type.

### Pitfall 2 — Assuming the alias is a *distinct* type

Code that relies on `Set[int]` being different from `map[int]struct{}` (e.g. for a type switch) will be surprised: they are the same type, so a `case Set[int]:` and `case map[int]struct{}:` would be a duplicate-case compile error.

### Pitfall 3 — Constraint too loose for the RHS

```go
type Set[T any] = map[T]struct{} // ERROR: T must be comparable to be a map key
```

The RHS dictates the *minimum* constraint.

### Pitfall 4 — Forgetting to instantiate

`Set` alone is not a type; `Set[string]` is. Using the bare name where a type is expected is an error.

### Pitfall 5 — Targeting the wrong Go version

On Go 1.23 the syntax only works with `GOEXPERIMENT=aliastypeparams`; on 1.22 and earlier it does not work at all. Use 1.24.

### Pitfall 6 — Aliasing to another generic alias and creating a cycle

```go
type A[T any] = B[T]
type B[T any] = A[T] // ERROR: invalid recursive (cyclic) alias
```

An alias may refer to another alias, but the chain must terminate at a real type.

### Pitfall 7 — Over-aliasing standard containers

Naming `map[string]T` as `M[T]` everywhere can make code *harder* to read for newcomers who must now learn your private vocabulary. Only name shapes whose name adds clarity.

---

## Common Mistakes

- **Trying to add methods to an alias.** The single most common surprise. Switch to a defined type.
- **Using `type A B` when you meant `type A = B`** (or vice versa). One creates a new type; the other creates a synonym. They behave very differently.
- **Setting the constraint to `any` for a map-based alias.** Map keys need `comparable`.
- **Expecting a type switch to distinguish the alias from its RHS.** It cannot; they are identical.
- **Writing the alias on an old toolchain** and getting a cryptic syntax error instead of a version error. Bump the `go` directive.
- **Deeply nesting aliases** so that the real underlying type is three hops away and unclear.

---

## Common Misconceptions

> *"A generic alias creates a new generic type."*

No. It creates a *parameterized synonym*. After instantiation it is identical to its RHS. No new type exists.

> *"I can give my alias methods to make it nicer."*

No. Aliases have no method set. Methods require a defined type.

> *"`Set[int]` and `map[int]struct{}` are merely assignable."*

Stronger than that — they are *identical*. No conversion, no assignability gymnastics; they are the same type.

> *"This is brand-new syntax with no history."*

The feature was years in the making (proposal #46477), available under an experiment flag in Go 1.23, and shipped on-by-default in Go 1.24.

> *"Aliases are just for shortening names."*

Shortening is one use; the bigger payoff is *preserving type identity* when re-exporting or migrating a generic type across packages.

> *"An alias adds runtime overhead."*

None. It is a compile-time renaming.

---

## Tricky Points

- **The `=` is everything.** `type Set[T] = ...` is an alias; `type Set[T] ...` is a defined type. One character changes the semantics completely.
- **The RHS sets the floor for the constraint.** You cannot use a constraint *weaker* than what the RHS requires.
- **An alias may refer to type parameters of its own**, but the count and names are local to the alias declaration.
- **Identity is computed after substitution.** `Pair[int, string]` is identical to `struct{ First int; Second string }`, and to any other alias that resolves to the same struct.
- **No exported/unexported method tricks.** Aliases neither add nor hide methods; they expose exactly the RHS's method set (which for a map is none).
- **Aliases can be partially or fully instantiated by other aliases:** `type IntSet = Set[int]` names the instantiation `map[int]struct{}`.

---

## Test

Try this in a scratch folder with Go 1.24+.

```go
package main

import "fmt"

type Set[T comparable] = map[T]struct{}
type Pair[A, B any]    = struct {
    First  A
    Second B
}

func main() {
    s := Set[string]{}
    s["x"] = struct{}{}

    var m map[string]struct{} = s // identity: no conversion
    fmt.Println(len(m))           // 1

    p := Pair[int, bool]{First: 7, Second: true}
    fmt.Println(p.First, p.Second) // 7 true
}
```

Now answer:
1. Does `var m map[string]struct{} = s` need a conversion? (Answer: no — `Set[string]` *is* `map[string]struct{}`.)
2. Can you add `func (s Set[T]) Len() int { return len(s) }`? (Answer: no — methods are illegal on an alias.)
3. What constraint must `Set`'s parameter have, and why? (Answer: `comparable`, because the RHS is a map and keys must be comparable.)
4. Is `Pair[int, bool]` a new type, or identical to its struct RHS? (Answer: identical.)

---

## Tricky Questions

**Q1.** Is `Set[int]` assignable to `map[int]struct{}` without a conversion?

A. Yes — they are *identical* types, so it is more than assignable; no conversion is ever needed.

**Q2.** Can I write `func (s Set[T]) Add(v T)` for `type Set[T comparable] = map[T]struct{}`?

A. No. You cannot declare methods on an alias. Use a defined type (`type Set[T comparable] map[T]struct{}`, no `=`) if you want `Add`.

**Q3.** Why can't `Set`'s constraint be `any`?

A. The RHS `map[T]struct{}` requires comparable keys, so `T` must satisfy `comparable`. A weaker constraint will not compile.

**Q4.** Does this work on Go 1.22?

A. No. Generic type aliases are fully supported only in Go 1.24 (experimental behind `GOEXPERIMENT=aliastypeparams` in 1.23). Earlier versions reject the syntax.

**Q5.** Is there any runtime cost to using `Set[string]` instead of `map[string]struct{}`?

A. None. The alias is resolved at compile time; the runtime type is exactly the map.

**Q6.** Can an alias reference another alias?

A. Yes — `type IntSet = Set[int]` is fine. The chain just must not be cyclic and must end at a real type.

**Q7.** If I have `type A[T any] = struct{ V T }` and `type B[T any] = struct{ V T }`, are `A[int]` and `B[int]` the same type?

A. Yes — both resolve to `struct{ V int }`, which is identical regardless of which alias produced it.

**Q8.** Can I put an alias's type parameter constraint that is itself generic, like `type X[T MyConstraint] = ...`?

A. Yes — any valid constraint (including a custom interface or a type set) may appear, exactly as for generic defined types.

**Q9.** What happens in a `switch x.(type)` with `case Set[int]:` and `case map[int]struct{}:`?

A. Compile error — duplicate case, because the two are the same type.

**Q10.** Does aliasing a generic type from another package require importing that package?

A. Yes — you must import it to name it: `type Widget[T any] = other.Widget[T]`.

---

## Cheat Sheet

```go
// ALIAS (same type, no methods):
type Set[T comparable] = map[T]struct{}
type Pair[A, B any]    = struct{ First A; Second B }
type Handler[T any]    = func(context.Context, T) error

// DEFINED TYPE (new type, can have methods):
type Set2[T comparable] map[T]struct{}
func (s Set2[T]) Add(v T) { s[v] = struct{}{} }

// Instantiate:
Set[string]          // == map[string]struct{}
Pair[int, string]    // == struct{ First int; Second string }

// Identity holds (no conversion):
var m map[string]struct{} = Set[string]{}
```

```
DECISION:
  Need methods or a distinct type?  ── yes ──> defined type (no '=')
                                     ── no  ──> alias (with '=')
```

| Symptom | Cause | Fix |
|---------|-------|-----|
| "cannot define methods on alias" | Tried to add a method to an alias | Use a defined type |
| "does not satisfy comparable" | Bad type argument for a map-key param | Use a comparable type |
| "requires go1.24" | Toolchain too old | Upgrade Go / bump `go.mod` |
| "requires instantiation" | Used bare alias name | Add `[...]` type args |
| duplicate case in type switch | Alias and RHS are the same type | Remove one case |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] State, in one sentence, the difference between `type A = B` and `type A B`
- [ ] Write a generic alias for a set and a pair
- [ ] Explain why `Set[int]` is *identical* to `map[int]struct{}`
- [ ] Explain why you cannot attach a method to an alias
- [ ] Pick the correct constraint for a map-based alias and say why
- [ ] Predict whether two generic-alias instantiations are the same type
- [ ] Name the Go version that ships generic type aliases by default
- [ ] Decide between an alias and a defined type for a given need
- [ ] Recognize and fix the "cannot define methods on alias" error
- [ ] Explain why generic aliases have zero runtime cost

---

## Summary

A *type alias* (`type A = B`) is a second name for an existing type — not a new type. Go 1.24 lets that alias carry **type parameters**, so you can write `type Set[T comparable] = map[T]struct{}` and instantiate it as `Set[string]`, which is *identical* to `map[string]struct{}`.

The defining property is transparency: after instantiation, a generic alias *is* its right-hand side. That buys readable names, free assignment with no conversions, and clean re-exporting across packages. The price is that an alias is not a new type — you cannot give it methods, and it cannot create an encapsulation boundary. When you need behavior or a distinct type, use a *defined* generic type (drop the `=`).

Match the constraint to what the RHS requires, target Go 1.24, document the alias as "the same type as its RHS," and you have a small, sharp tool for tidying generic APIs.

---

## What You Can Build

After learning this:

- **A readable container vocabulary** for your package: `Set[T]`, `ByID[T]`, `Pair[A, B]`, `Handler[Req, Res]`.
- **A re-export shim** that exposes another package's generic type under your own path with identical type identity.
- **A migration alias** that keeps old import paths compiling while you move a generic type to a new home.
- **A friendlier API surface** where long functional-option and callback signatures get a single, well-named alias.

You cannot yet:
- Attach methods or invariants to the named shape (next: defined generic types)
- Re-export across packages while managing constraint compatibility cleanly (senior.md)
- Reason about constraint satisfiability and inference interactions (middle.md / professional.md)

---

## Further Reading

- [Go 1.24 Release Notes — Language changes](https://go.dev/doc/go1.24#language) — announces full support for generic type aliases.
- [Go Spec — Alias declarations](https://go.dev/ref/spec#Alias_declarations) — the authoritative rules, including the parameterized form.
- [Go Spec — Type definitions](https://go.dev/ref/spec#Type_definitions) — contrast with defined types.
- [Proposal #46477: spec: allow type parameters on type aliases](https://go.dev/issue/46477) — the design history.
- [Go Spec — Type identity](https://go.dev/ref/spec#Type_identity) — why `Set[int]` and `map[int]struct{}` are the same type.

---

## Related Topics

- [18.1 Generics Basics](../01-generics-basics/junior.md) — type parameters, constraints, instantiation
- 18.2 Type Inference — how arguments are inferred
- [18.3 Iterators / range-over-func](../03-range-over-func/junior.md) — another Go 1.23/1.24 language addition
- Defined Generic Types — when you need methods and a distinct type
- Type Identity & Assignability — the rules an alias relies on

---

## Diagrams & Visual Aids

```
Alias vs defined type:

    type Set[T comparable] = map[T]struct{}      ← ALIAS  ('=' present)
            │
            └── Set[int]  IS  map[int]struct{}    (identical, no methods)

    type Set[T comparable]   map[T]struct{}       ← DEFINED ('=' absent)
            │
            └── Set[int]  is a NEW type           (distinct, can have methods,
                                                   needs conversion to map)
```

```
Instantiation pipeline for Set[string]:

    Set[string]
        │  (1) check: string satisfies comparable?  ✓
        ▼
    substitute T = string into RHS  →  map[string]struct{}
        │  (2) alias name now irrelevant to identity
        ▼
    type used = map[string]struct{}
```

```
Identity is transparent:

    var a Set[int]            ──┐
    var b map[int]struct{}    ──┤  same type
    a = b   // ok                │  no conversion
    b = a   // ok              ──┘
```
