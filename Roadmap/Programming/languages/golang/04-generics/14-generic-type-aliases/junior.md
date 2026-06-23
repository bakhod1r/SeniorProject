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
> Focus: "What is a type alias?" and "Why was it special before 1.24?"

Go has had two ways to name a type for over a decade:

1. **Defined type** — `type Celsius float64`. A new, distinct type.
2. **Alias** — `type Celsius = float64`. **Same** type, just another name.

The single `=` is easy to miss but the difference is huge. A defined type has its own identity and can carry methods. An alias is just a second sticker on the same box.

Aliases were introduced in **Go 1.9 (2017)** to support the `io/ioutil` → `io`/`os` reorganisation: re-export a symbol without breaking callers. They worked beautifully — for non-generic types.

When generics arrived in **Go 1.18 (2022)**, type aliases stayed **non-generic**. You could write `type Names = []string` but **not** `type Vec[T any] = []T`. The compiler rejected the second form. Library authors who wanted to re-export a generic type had to fall back on defined types, which changed identity and broke everything.

**Go 1.24 (February 2025)** fixed this. Aliases can now have type parameters:

```go
// Pre-1.24: forbidden
// type Vec[T any] = []T  // compile error in 1.18 - 1.23

// Go 1.24+
type Vec[T any] = []T  // OK
```

That single line of grammar relaxes the last awkward corner of the generics design. After this file you will:

- Know the difference between `type X = Y` (alias) and `type X Y` (defined type).
- Read `type Vec[T any] = []T` and understand that `Vec[int]` IS `[]int`.
- Spot the three classic reasons to want a generic alias: re-exporting, simplification, migration.
- Know which Go version you need (**1.24 or newer**).

---

## Prerequisites
- You have read `01-why-generics` and `02-generic-functions`.
- You can declare a generic type: `type Stack[T any] struct { ... }`.
- You understand the difference between a named type and an underlying type.
- Go **1.24+** is installed (`go version` should print `go1.24` or later).

---

## Glossary

| Term | Definition |
|------|------------|
| **Alias declaration** | `type X = Y` — `X` is just another name for `Y`. |
| **Defined type** | `type X Y` — `X` is a brand-new type with `Y` as underlying. |
| **Type parameter** | A placeholder like `T` introduced in `[ ]`. |
| **Type argument** | The actual type given at instantiation. |
| **Identity** | Two types are identical if Go treats them as the same. |
| **Re-export** | Exposing a symbol from one package via another package. |
| **Underlying type** | The structural shape behind a named type. |
| **Method set** | The set of methods declared on a type. |
| **`GOEXPERIMENT`** | Compile-time toggle for in-development features. |
| **Generic alias** | `type X[T any] = Y` — a parameterized alias (1.24+). |

---

## Core Concepts

### 1. Two ways to name a type

The single `=` flips the meaning entirely.

```go
// Defined type — new identity, can carry methods
type Celsius float64
func (c Celsius) Freezing() bool { return c <= 0 }

// Alias — same type, no new identity, no new methods
type Temperature = float64
// func (t Temperature) Hot() bool { return t > 30 }  // ERROR: cannot define methods on a non-local type
```

A defined type is a fresh box. An alias is a sticker on an existing box.

### 2. Generic alias — the 1.24 addition

Until 1.24, aliases were non-generic only:

```go
// Always allowed
type StringSlice = []string

// Pre-1.24: rejected — "type alias cannot have type parameters"
type Slice[T any] = []T
```

Go 1.24 lifted that rule. Now you can write:

```go
type Vec[T any] = []T

var nums Vec[int] = []int{1, 2, 3}
fmt.Println(nums) // [1 2 3]
```

`Vec[int]` and `[]int` are **the same type**. You can pass one to a function expecting the other, no conversion required.

### 3. Three reasons you want this

1. **Re-export** — expose another package's generic type under your own name.
2. **Shorter signatures** — give a long generic instantiation a friendly local alias.
3. **Migration** — move a generic type between packages without breaking callers.

We will see each one in `Code Examples` below.

### 4. Identity, in one sentence

`type Vec[T any] = []T` means: `Vec[int] == []int`, `Vec[string] == []string`, and so on, **for every** `T`. The alias does not introduce a new type — it gives an existing parameterized type a second name.

### 5. The "no methods on alias" rule still applies

You cannot declare methods on an alias, and that is unchanged in 1.24:

```go
type Vec[T any] = []T

// ERROR: cannot define new methods on non-local type []T
func (v Vec[T]) Len() int { return len(v) }
```

If you need methods, use a defined type, not an alias.

---

## Real-World Analogies

**Analogy 1 — Sticker vs new package**

Imagine a parcel arriving with a delivery label "Box A". A defined type is like opening Box A, repackaging the contents into Box B with new wrapping, and adding new instructions. An alias is like sticking a "ALSO KNOWN AS Box B" sticker on the same parcel. Internally it is still Box A.

**Analogy 2 — Nicknames**

A defined type is a legal name change. An alias is a nickname. People can call you by either, but your passport (your type identity) is the same.

**Analogy 3 — Symbolic links vs file copies**

In a filesystem, `cp file.txt copy.txt` makes a new file (defined type). `ln -s file.txt link.txt` makes a symbolic link (alias). Editing the link edits the original. Editing the copy does not.

**Analogy 4 — Same building, two addresses**

A corner building can have a Main St entrance and a 5th Ave entrance. The building is one. The addresses are two. `[]int` is the building; `Vec[int]` is one of its addresses.

---

## Mental Models

### Model 1 — "The compiler erases the alias"

Whenever the compiler sees `Vec[int]`, mentally rewrite it as `[]int` before reasoning about the code. The alias is a textual shortcut; after substitution, only the underlying parameterized type remains.

### Model 2 — "Aliases never make new method sets"

If you find yourself wanting to write `func (v Vec[T]) Push(x T) { ... }`, stop. Aliases cannot carry methods. You want a defined type.

### Model 3 — "Re-export is the killer use case"

The single best reason to use a generic alias is to re-export someone else's type:

```go
package mypkg
import "otherpkg"
type Result[T any] = otherpkg.Result[T]
```

Anything else is usually better expressed as a defined type or a function.

### Model 4 — "1.24 fixed a generics gap"

The generics design landed in 1.18 with one known TODO: aliases cannot have type parameters. That TODO was resolved in 1.24. If you read older Go materials saying "you cannot have generic aliases", they are pre-1.24.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Same identity** | `Vec[int]` IS `[]int`. No conversion needed. |
| **Easy re-export** | One line republishes someone else's generic type. |
| **Shorter local names** | A long generic instantiation gets a friendly nickname. |
| **No runtime cost** | Aliases are erased at compile time. |
| **Smooth migration** | Move a type between packages without breaking callers. |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **No methods** | Aliases cannot carry methods; use a defined type if you need them. |
| **Requires Go 1.24+** | Older toolchains reject the syntax. |
| **Confusion with defined types** | The single `=` is easy to forget. |
| **Some IDEs lag** | Static-analysis tools needed updates. |
| **Cannot be embedded** | An alias-of-an-interface cannot be embedded the way a defined interface can. |

---

## Use Cases

Generic aliases shine in:

1. **Library re-exports** — `type Set[T comparable] = internal.Set[T]`.
2. **Migration paths** — old package keeps an alias; new package owns the type.
3. **Type abbreviations** — `type StringMap[V any] = map[string]V` reduces repetition.
4. **Constraint shortcuts** — `type IntsOrStrings = ints.Family | strings.Family` (with constraint elements, in supported forms).
5. **Generic "newtypes" with no methods** — when you only want a friendly name.

Generic aliases are **not** ideal for:

1. Adding methods (use a defined type).
2. Hiding or restricting the underlying type (alias means equivalence, not encapsulation).
3. Anything older than Go 1.24 where the syntax simply does not compile.

---

## Code Examples

### Example 1 — The simplest generic alias

```go
package main

import "fmt"

type Vec[T any] = []T

func main() {
    var v Vec[int] = []int{1, 2, 3}
    fmt.Println(v) // [1 2 3]

    // Vec[int] IS []int — no conversion needed
    var s []int = v
    fmt.Println(s) // [1 2 3]
}
```

### Example 2 — A friendly map alias

```go
type StringMap[V any] = map[string]V

func main() {
    var m StringMap[int] = map[string]int{"a": 1, "b": 2}
    for k, v := range m {
        fmt.Println(k, v)
    }
}
```

`StringMap[int]` is exactly `map[string]int`. Any function taking `map[string]int` happily accepts `StringMap[int]`.

### Example 3 — Re-export from another package

```go
// package container
package container

type List[T any] struct{ data []T }

func (l *List[T]) Append(v T) { l.data = append(l.data, v) }
```

```go
// package mypkg
package mypkg

import "example.com/container"

// Republish container.List under our package name
type List[T any] = container.List[T]
```

Now callers can write `mypkg.List[int]` and it is the **same type** as `container.List[int]`. No wrapping, no conversion.

### Example 4 — Migration: move a type without breaking callers

```go
// Old location: pkg/legacy
package legacy

// Now an alias forwarding to the new location
type Result[T any] = newpkg.Result[T]
```

```go
// New location: pkg/newpkg
package newpkg

type Result[T any] struct {
    Value T
    Err   error
}
```

Existing imports of `legacy.Result[int]` keep working. New code targets `newpkg.Result[int]`. The two are identical to the compiler.

### Example 5 — Aliases in signatures

```go
type Pair[A, B any] = struct{ First A; Second B }

func MakePair[A, B any](a A, b B) Pair[A, B] {
    return Pair[A, B]{First: a, Second: b}
}

func main() {
    p := MakePair(1, "hello")
    fmt.Println(p.First, p.Second) // 1 hello
}
```

Note: structurally typed aliases are a bit unusual; for ergonomics most teams prefer a defined `type Pair[A, B any] struct { ... }`. But it compiles.

### Example 6 — Comparing alias vs defined type

```go
type AliasVec[T any] = []T

type DefinedVec[T any] []T

func main() {
    var a AliasVec[int]   = []int{1, 2}
    var d DefinedVec[int] = []int{1, 2}

    var s []int = a // OK — same type
    // var s2 []int = d // ERROR — DefinedVec[int] is a distinct type
    _ = s
    _ = d
}
```

The alias is interchangeable with `[]int`. The defined type requires an explicit conversion.

---

## Coding Patterns

### Pattern 1 — Re-export-and-deprecate

```go
// Deprecated: use newpkg.Cache.
type Cache[K comparable, V any] = newpkg.Cache[K, V]
```

A single-line alias plus a `Deprecated:` comment is the canonical migration shape.

### Pattern 2 — Local convenience name

When a function repeatedly takes `map[string][]T`, give it a name:

```go
type Index[T any] = map[string][]T

func Add[T any](idx Index[T], key string, v T) {
    idx[key] = append(idx[key], v)
}
```

### Pattern 3 — Don't shadow stdlib

Avoid alias names that shadow widely known stdlib names: `type Map[K, V any] = map[K]V` looks clever but confuses readers expecting `map[K]V` semantics.

### Pattern 4 — Pair with defined type when methods are needed

If today you only need a name (alias), but tomorrow might need methods (defined type), document the choice in a comment so future maintainers know why.

---

## Clean Code

- **Use aliases for naming, not for new behaviour.** If you want methods, declare a defined type.
- **Document re-exports.** A bare `type Foo[T any] = bar.Foo[T]` deserves a comment explaining "from package bar".
- **Match parameter names.** If `bar.Foo` uses `[T any]`, use `[T any]` in the alias too — do not rename to `[X any]` unless you have a reason.
- **Prefer module path migrations** when re-exporting whole packages; aliases are best for individual symbols.

```go
// Clean
// Result re-exports newpkg.Result for backwards compatibility.
// Deprecated: use newpkg.Result directly.
type Result[T any] = newpkg.Result[T]

// Less clean — no comment, renamed parameter
type Result[X any] = newpkg.Result[X]
```

---

## Product Use / Feature

Concrete product scenarios:

1. **SDK splits** — when a library reorganises into sub-packages, generic aliases keep old import paths working for one or two releases.
2. **Vendored generic libraries** — internal forks can re-export upstream's generic types under the company namespace.
3. **API compatibility windows** — frameworks moving generic types between modules use aliases to avoid breaking dependent services.
4. **Code-generated wrappers** — codegen pipelines emit a tiny alias-only wrapper module for each upstream generic.
5. **Test fixtures** — tests can alias long generic types into short local names: `type Resp = ServerResponse[map[string]any]`.

---

## Error Handling

Generic aliases do not change Go's error model. They are passive declarations — declared types only. The compiler errors associated with them are:

- **"cannot define methods on non-local type"** — you tried to attach a method to an alias.
- **"type alias cannot have type parameters"** — you are on Go < 1.24.
- **"undeclared name"** — the underlying generic type was not found.
- **"undefined: ..."** — likely a missing import for the re-exported type.

Always check `go version` first when these errors appear; many "spurious" errors come from compiling 1.24 code with an older toolchain.

---

## Security Considerations

Aliases are pure compile-time names — they introduce no new code paths and therefore no new attack surface. Two practical notes:

1. **Re-exports do not change visibility.** If `bar.Foo` is exported from package `bar`, aliasing it in `myprivpkg` does not encapsulate it. Callers can still touch fields of the original type.
2. **Be careful with security-sensitive types** — if `crypto.Key[T]` becomes available under `mypkg.Key[T]` via alias, package-level mutation rules still apply. Aliases do not provide a security boundary.

---

## Performance Tips

- **Aliases are zero-cost at runtime.** They erase to the underlying type before code generation.
- **Compile time** is essentially unchanged — the parser does a tiny extra step but no extra stenciling occurs.
- **Binary size is unchanged.** No new code is emitted; the alias name resolves to the existing type's symbol.
- **Avoid aliasing for "performance reasons"** — there is nothing to optimize. Use them for readability and re-exports.

A simple rule: **performance considerations should not influence the choice between alias and defined type**. Pick based on identity and method needs.

---

## Best Practices

1. **Reach for an alias** when you want a synonym or a re-export.
2. **Reach for a defined type** when you want methods or distinct identity.
3. **Document every re-export** with a `// Deprecated:` line if the original is preferred.
4. **Keep the type parameter list identical** between the alias and the original.
5. **Bump `go.mod`'s `go` directive to `1.24`** before introducing generic aliases.
6. **Test after migration** — aliases are wire-compatible but tools (older `gopls`, older linters) may lag.
7. **Avoid stacking** — `type A[T any] = B[T]; type B[T any] = C[T]; ...` is hard to read.
8. **Resist clever names** — `type V[T any] = []T` is shorter than `Vector` but harms readability in shared codebases.

---

## Edge Cases & Pitfalls

### 1. Methods cannot be attached

```go
type Vec[T any] = []T
func (v Vec[T]) Len() int { return len(v) } // compile error
```

The error is "cannot define new methods on non-local type". Aliases never carry methods.

### 2. The Go version check

```go
type Vec[T any] = []T
```

If you compile this with Go 1.23, the error is "type alias cannot have type parameters". Bump `go.mod` to `go 1.24`.

### 3. Aliases of interfaces

```go
type Stringer = fmt.Stringer       // legacy non-generic alias, OK forever
type Boxer[T any] = interface { Box(T) } // 1.24+
```

The interface alias works, but a value of type `Boxer[int]` and a value of type `interface{ Box(int) }` are the same type. You cannot embed `Boxer[int]` to gain a method set in another interface — embedding aliases of interfaces is a separate spec discussion.

### 4. The underlying type must be valid

```go
type Vec[T any] = []T // OK
type Bad[T any] = T   // OK — alias to a type parameter
```

The right-hand side is parsed as a type. Anything that would be a valid type expression at that point works.

### 5. Constraints in alias parameters

```go
type Set[T comparable] = map[T]struct{}
```

Constraints attached to alias parameters work the same as on a generic type. Each instantiation must satisfy the constraint.

### 6. Re-exporting also re-exports the constraint

If `bar.Foo[T comparable]` requires `comparable`, then `mypkg.Foo[T] = bar.Foo[T]` inherits that constraint — and the alias declaration must repeat it as `type Foo[T comparable] = bar.Foo[T]`.

---

## Common Mistakes

1. **Trying to add methods to an alias.** Use a defined type instead.
2. **Forgetting to bump `go.mod`** to `1.24`.
3. **Mismatched constraint** — the alias declares `[T any]` while the original requires `[T comparable]`.
4. **Renaming the type parameter** for no reason — confuses readers.
5. **Aliasing a type just to "rename" it** in an exported API — readers may expect a real new type.
6. **Stacking aliases** five layers deep — pick a single canonical name.
7. **Embedding an alias-of-interface** and expecting it to behave like a defined interface.

---

## Common Misconceptions

- **"A generic alias is a new type."** No. Same type, different name.
- **"I can attach methods to a generic alias."** No. Aliases never carry methods.
- **"`type X[T any] = Y[T]` makes `X` distinct from `Y`."** It does not. `X[int]` and `Y[int]` are identical.
- **"I need a `GOEXPERIMENT` flag."** Not anymore — Go 1.24 makes generic aliases default. You needed `GOEXPERIMENT=aliastypeparams` only on 1.22 / 1.23.
- **"Aliases work in any Go version."** Plain aliases yes (since 1.9); **generic aliases require 1.24+**.

---

## Tricky Points

1. **The single `=` is load-bearing.** Drop it and you have a defined type, not an alias.
2. **Aliases share method sets only because they share types**, not because aliases inherit anything.
3. **An alias of a generic interface can be used as a constraint** if the underlying interface is valid as a constraint.
4. **Re-exporting a generic type via alias does not re-export the underlying file's constants, functions, or other types.** Only the named type.
5. **The Go 1.24 minimum applies even if the alias is unused** — the syntax itself is rejected by older versions.

---

## Test

Test yourself before continuing.

1. What is the difference between `type X = Y` and `type X Y`?
2. Which Go version made generic aliases the default?
3. Can you declare methods on a generic alias?
4. What does `type Vec[T any] = []T` mean?
5. Are `Vec[int]` and `[]int` the same type or two compatible types?
6. What is the canonical use case for generic aliases?
7. Why was the no-generic-aliases restriction a real problem before 1.24?
8. What `GOEXPERIMENT` flag enabled this feature in 1.22 / 1.23?
9. If you alias a generic type, must the constraints on the parameters match?
10. Can two aliases reach the same underlying type?

(Answers: 1) `=` makes an alias, no `=` makes a defined type; 2) 1.24; 3) no; 4) `Vec[T]` is another name for `[]T`; 5) the same; 6) re-exporting / migration; 7) library authors could not republish a generic type without changing its identity; 8) `aliastypeparams`; 9) yes; 10) yes.)

---

## Tricky Questions

**Q1.** Will this compile in Go 1.24?
```go
type Vec[T any] = []T
func (v Vec[T]) Len() int { return len(v) }
```
**A.** No. Methods on aliases are not allowed; it errors with "cannot define new methods on non-local type".

**Q2.** Are `Vec[int]` and `[]int` interchangeable in function signatures?
**A.** Yes — they are the **same** type.

**Q3.** Can a generic alias rename the type parameter?
```go
type Vec[Element any] = []Element
```
**A.** Yes. The parameter name is local to the alias. But for clarity, match the convention of the original.

**Q4.** Can a generic alias point to another generic alias?
```go
type A[T any] = []T
type B[T any] = A[T]
```
**A.** Yes. Both `A[int]` and `B[int]` are `[]int`.

**Q5.** What does this print?
```go
type Vec[T any] = []T
var v Vec[int]
fmt.Printf("%T\n", v)
```
**A.** `[]int`. The alias has no separate runtime identity.

---

## Cheat Sheet

```go
// Plain alias (since 1.9)
type Bytes = []byte

// Defined type (since forever)
type Celsius float64
func (c Celsius) Freezing() bool { return c <= 0 }

// Generic alias (Go 1.24+)
type Vec[T any] = []T

// Generic re-export
type Result[T any] = newpkg.Result[T]

// Friendly map alias
type StringMap[V any] = map[string]V
```

| Form | Methods? | New identity? | Since |
|------|----------|---------------|-------|
| `type X = Y` | No | No | 1.9 |
| `type X Y` | Yes | Yes | always |
| `type X[T any] = Y[T]` | No | No | 1.24 |
| `type X[T any] Y[T]` (parameterised defined type) | Yes | Yes | 1.18 |

---

## Self-Assessment Checklist

- [ ] I know the syntactic difference between alias and defined type.
- [ ] I can write a generic alias and explain its identity rule.
- [ ] I know which Go version is required.
- [ ] I can re-export a generic type in one line.
- [ ] I know aliases cannot carry methods.
- [ ] I can pick between alias and defined type for a given task.
- [ ] I have read the 1.24 release notes for type aliases.
- [ ] I understand why this feature closes a generics gap.

If you ticked at least 6 boxes, move on to `middle.md`.

---

## Summary

Type aliases (`type X = Y`) and defined types (`type X Y`) have always been different — same identity vs new identity. Generics from 1.18 to 1.23 supported only **non-generic** aliases, which forced library authors to use defined types whenever a generic re-export was needed.

Go 1.24 lifts the restriction. `type Vec[T any] = []T` now compiles, and `Vec[int]` is identical to `[]int`. The new form is best used for **re-exports**, **migrations**, and **friendly local names**. It does not change runtime behaviour and cannot carry methods.

The single biggest takeaway: when you see a generic alias, mentally substitute the underlying type. After substitution, it is just a generic type expression, exactly as it was without the alias name.

---

## What You Can Build

After this section you can build:

1. A re-export module that republishes a popular generic library under your namespace.
2. A migration shim that moves a generic type between two of your packages without breaking callers.
3. A test-helper package with friendly local aliases for long generic instantiations.
4. A "constraints" sub-package using aliased union types where appropriate.
5. A clean public API that uses `type Set[T comparable] = internal.Set[T]` to expose only one external entry point.

---

## Further Reading

- [Go 1.24 release notes](https://go.dev/doc/go1.24)
- [Go spec — Alias declarations](https://go.dev/ref/spec#Alias_declarations)
- [Type Parameters Proposal](https://go.googlesource.com/proposal/+/HEAD/design/43651-type-parameters.md)
- [Issue 46477 — generic type aliases](https://github.com/golang/go/issues/46477)
- [Russ Cox: "Generic aliases"](https://research.swtch.com/) (community discussions linked over time)

---

## Related Topics

- **4.10 Generic Limitations** — list of what generics still cannot do (this topic resolves one of those)
- **4.11 Methods on Generic Types** — when you need methods, you need a defined type
- **4.3 Generic Types & Interfaces** — generic type declarations
- **4.4 Type Constraints** — constraints carry over to alias parameters
- **2.x Type Declarations** — the original alias vs defined type distinction

---

## Diagrams & Visual Aids

### Alias vs defined type

```
type Vec[T any] = []T          type Vec[T any] []T
        │                              │
        ▼                              ▼
   same type as                  new type with
   []T at every                  []T as underlying
   instantiation                 (own method set
                                  possible)
```

### Re-export with a generic alias

```
package newpkg          package legacy           import path
+-----------------+     +-----------------+
| type Result[T]  | <-- | type Result[T]  |
| struct {...}    |     | = newpkg.Result | <-- old callers still happy
+-----------------+     +-----------------+
```

### Why the 1.24 fix matters

```
Before 1.24:                       After 1.24:
  Re-export needs                    type X[T any] = otherpkg.X[T]
  defined type → identity changes      identity preserved
  -- callers' code breaks            -- callers' code unchanged
```
