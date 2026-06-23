# Generic Constraints Deep Dive — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. The questions focus exclusively on **constraints** — not generics in general. For broader generic Q&A see `../01-why-generics/interview.md`.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What is a type constraint, structurally?
**Short:** An interface.

**Long:** Go's spec says: "A type constraint is an interface that defines the set of permissible type arguments." Go did not invent a new "constraint" feature — it extended interfaces so they may contain type elements (`int | string`, `~T`) in addition to method elements.

### Q2. Name the two predeclared constraints.
**Short:** `any` and `comparable`.

**Long:** `any` is an alias for `interface{}` — every type satisfies it. `comparable` is a special predeclared interface for types usable with `==` and `!=`.

### Q3. What does `~int` mean in a constraint?
**Short:** Any type whose underlying type is `int`.

**Long:** `~int` accepts the predeclared `int` plus every defined type whose underlying type is `int`, e.g. `type Celsius int`. Without the tilde, only the bare `int` qualifies.

### Q4. What does `int | string` mean?
**Short:** Either `int` or `string` — a union.

**Long:** A type element with `|` is a union of type terms. The constraint's type set is the union of the listed sets. `int | string` allows the predeclared `int` or `string` (no defined types unless `~int | ~string`).

### Q5. What is a "type set"?
**Short:** The set of types that satisfy a constraint.

**Long:** Every interface (including constraints) defines a type set — the collection of types that implement it. The compiler reasons about constraint satisfaction as set membership.

### Q6. Does `comparable` allow `<`?
**Short:** No — only `==` and `!=`.

**Long:** For ordering operators (`<`, `<=`, `>`, `>=`) you need `cmp.Ordered` (Go 1.21+) or a similar union of ordered types.

### Q7. Can a constraint contain methods?
**Short:** Yes.

**Long:** A constraint is an interface; an interface can contain method elements. The body of the generic function can call those methods on values of the type parameter.

### Q8. Can a constraint contain both methods and types?
**Short:** Yes — they intersect.

**Long:** `interface { ~int; String() string }` requires both an `int` underlying type and a `String() string` method. Both conditions must hold.

### Q9. What is the difference between `any` and `interface{}`?
**Short:** None — `any` is an alias.

**Long:** `type any = interface{}`. The alias was added in Go 1.18 alongside generics for readability. Use `any` in new code.

### Q10. Where does the spec define constraints?
**Short:** Section "Type constraints" in <https://go.dev/ref/spec#Type_constraints>.

---

## Mid-level 🟡

### Q11. Why must `~T` not be applied to an interface?
**Short:** The spec forbids it; `~T` only makes sense for non-interface underlying types.

**Long:** The "underlying type" of an interface is the interface itself — there is no useful widening. The spec rules out `~error`, `~io.Reader`, etc.

### Q12. Can `comparable` be used as a runtime variable type?
**Short:** Not in the usual way. It is a constraint-only interface.

**Long:** You cannot write `var x comparable = 1; pass(x)` and have `x` participate as a regular interface value. `comparable` is special: the compiler accepts it as a constraint but rejects it as a normal runtime variable type. (Some narrow runtime uses are allowed, but production code rarely needs them.)

### Q13. What is an empty type set?
**Short:** A constraint whose type set has no members.

**Long:** Most often arises when intersecting disjoint type elements: `interface { int; string }` has empty type set (intersection of `{int}` and `{string}` is empty). Functions using such a constraint compile but cannot be instantiated.

### Q14. How is constraint satisfaction defined when the candidate is itself an interface?
**Short:** By type set inclusion: the candidate's type set must be a subset of the constraint's type set.

**Long:** Spec: "A type T implements an interface if T is an interface and the type set of T is a subset of the type set of the interface." Concrete types use membership; interfaces use subset.

### Q15. What is the intersection of `interface { int | string }` and `interface { int | float64 }`?
**Short:** `{int}`.

**Long:** Type sets: `{int, string} ∩ {int, float64} = {int}`. The intersection is computed term-by-term.

### Q16. Why was `comparable` loosened in Go 1.20?
**Short:** To allow interface types as type arguments, even though `==` may panic at runtime.

**Long:** Pre-1.20, interface types failed `comparable` because their dynamic value might be non-comparable. This created an asymmetry: `map[any]int` worked, but a generic map keyed by `any` did not. Go 1.20 changed the spec so interfaces satisfy `comparable` at compile time, with a runtime panic possibility.

### Q17. Describe how to design a constraint hierarchy.
**Short:** Layered embedding — predeclared, stdlib, then domain. Reuse before reinventing.

**Long:** Start from `any`/`comparable`, then `cmp.Ordered`, then your domain constraints. Each layer embeds the previous. Avoid giant unions; split into named constraints for clarity.

### Q18. What is `cmp.Ordered`?
**Short:** A predeclared (in `cmp`) interface for types usable with `<`, `<=`, `>`, `>=`.

**Long:** `cmp.Ordered` (Go 1.21+) is essentially `~int | ~int8 | ... | ~uint... | ~float32 | ~float64 | ~string`. It is the canonical "ordered type" constraint. Hand-rolling your own is now an anti-pattern.

### Q19. What is the relationship between `golang.org/x/exp/constraints.Ordered` and `cmp.Ordered`?
**Short:** The latter superseded the former in Go 1.21.

**Long:** `x/exp/constraints` was the bridge from 1.18 to 1.21. With Go 1.21, `Ordered` was promoted to stdlib `cmp.Ordered`. The `x/exp` version still exists for code targeting older Go, but new code should use `cmp.Ordered`.

### Q20. Why might `range` not compile inside a generic function?
**Short:** The constraint may have no core type.

**Long:** `range` requires a core type (string/array/slice/map/channel). If the constraint's type set contains types with different underlying types (`~[]int | ~[]string`), there is no core type and `range` is rejected. Use `[T ~[]E, E any]` to give the slice element a name.

---

## Senior 🔴

### Q21. Compare `[T comparable]` and `[T any]` from the body's perspective.
**Short:** `comparable` authorises `==`/`!=`; `any` authorises only operations independent of T.

**Long:** With `any`, you can pass `T`, return `T`, store `T`, range over `[]T`. You cannot use `==`, `<`, `+`, methods, or `len(t)`. With `comparable`, you additionally use `==` and `!=`. With `cmp.Ordered`, you also use `<`, `<=`, `>`, `>=`. The constraint dictates the body.

### Q22. When would you mix types and methods in a constraint?
**Short:** When you need both structural shape and behaviour.

**Long:** Example: `interface { ~int; String() string }`. A function that needs to format an integer-shaped domain value via its `String()` method requires both. Interfaces alone (no `~int`) lose the integer shape; type elements alone (no method) lose the behaviour.

### Q23. How do you write a generic slice helper that preserves the named slice type?
**Short:** Two type parameters: the slice and its element.

**Long:**
```go
func Reverse[S ~[]E, E any](s S) S {
    out := make(S, len(s))
    for i, v := range s { out[len(s)-1-i] = v }
    return out
}
```
Calling `Reverse(MySlice{1,2,3})` returns `MySlice`, not `[]int`. The constraint `~[]E` ties the slice type to its element.

### Q24. Why does this not compile?
```go
type C interface { ~[]int | ~[]string }
func F[T C](s T) int { return len(s) }
```
**Short:** No core type — different underlying slice types.

**Long:** The type set has elements `~[]int` and `~[]string` — different underlying types. `len` requires a core type, which exists only if all members share an underlying type. Fix: parameterise the element: `[T ~[]E, E any]`.

### Q25. What is a self-bounded constraint?
**Short:** A constraint whose interface mentions the type parameter itself.

**Long:**
```go
type Less[T any] interface { LessThan(other T) bool }
func Min[T Less[T]](a, b T) T { ... }
```
`T` must satisfy `Less[T]`. The pattern enables methods that take a "self" parameter. Powerful but adds reader cognitive load.

### Q26. How can you safely loosen a constraint without breaking callers?
**Short:** Add a term to a union or remove a method requirement.

**Long:** Loosening expands the type set. Every existing call site continues to work, since its type still satisfies the wider constraint. Tightening (removing a term, adding a method) breaks callers and requires a major-version bump.

### Q27. What is the difference between interface-as-constraint and interface-as-runtime-type?
**Short:** Same syntactic construct, different role.

**Long:** As a constraint, an interface defines a type set the compiler uses for type checking. As a runtime type, the interface is a `(type, data)` pair used for dynamic dispatch. Some interfaces (like `comparable`) can only be used as constraints. Others (like `io.Reader`) work in both roles.

### Q28. How do you reason about constraint satisfaction when the candidate is itself an interface?
**Short:** Check that the candidate's type set is a subset of the constraint's type set.

**Long:** This is the spec's "type set inclusion" rule. Example: `interface{ String() string }` does NOT satisfy `interface{ String() string; comparable }` because the first set includes types that are not comparable.

### Q29. Why is `~struct{ X, Y int }` legal but rarely used?
**Short:** The underlying type of a struct is its literal field shape; matching is structural.

**Long:** A constraint `~struct{ X, Y int }` admits any defined struct with exactly fields `X int, Y int`. Real programs rarely have multiple named structs sharing identical fields, so the construct is mostly academic.

### Q30. What happens when a function uses a constraint with an empty type set?
**Short:** It compiles but cannot be instantiated.

**Long:** No type satisfies the constraint, so no call site can supply a valid type argument. The function exists in source form but is dead code. Linters (e.g. `staticcheck SA9009`) flag this.

---

## Expert 🟣

### Q31. Why does the spec use intersection for multiple interface elements?
**Short:** Each element narrows the requirement; logically "and".

**Long:** A type satisfies an interface only if it satisfies **every** element. That is intersection. Union (`|`) inside a single type element is the only place "or" appears. The asymmetry — `;` (or newline) for AND, `|` for OR — is a frequent point of confusion.

### Q32. Walk through the type set algebra for a complex constraint.
**Short:** Compute each element's set, then intersect.

**Long:**
```go
type C interface {
    ~int | ~float64        // {Numeric defined types}
    Stringer               // {types with String() string}
    comparable             // {strictly comparable types}
}
```
Step 1: `~int | ~float64` → all defined types whose underlying is `int` or `float64`. Step 2: `Stringer` → all types with `String() string`. Step 3: `comparable` → strictly comparable types. Intersection: defined int/float types that have `String` and are comparable. Each int-or-float defined type with a `String` method qualifies (ints are comparable).

### Q33. Why was `comparable`'s pre-1.20 strictness considered a problem?
**Short:** It excluded common types like `any` and structs containing `any`.

**Long:** Real Go code is full of types containing `interface{}` fields. Pre-1.20, those failed `comparable`, blocking generic adoption. The 1.20 loosening — accept at compile time, panic at runtime if needed — fixed the ergonomics at the cost of a runtime risk.

### Q34. How can a library evolve a constraint safely?
**Short:** Loosen freely, tighten only with a major version bump.

**Long:** Every constraint is a public contract. Adding terms to a union, removing method requirements, embedding wider constraints — all safe. Removing terms, adding methods, narrowing the embed graph — all breaking. Treat constraints like exported types: design carefully, version disciplined.

### Q35. Why does the compiler reject `func F[T int | string](a, b T) T { return a - b }`?
**Short:** `-` is not defined for `string`.

**Long:** The body must work for **every** type in the constraint's type set, with the same operator semantics. Subtraction is undefined for strings, so the compiler refuses. (Compare `+`, which works for both — addition for ints, concatenation for strings — and is allowed.)

### Q36. What is "core type" and when does it matter?
**Short:** The unique underlying type of all members of a type set, when one exists.

**Long:** The spec defines core type for constraints whose type set has a single underlying type (or a uniform channel direction). Operations like `len`, indexing, `range`, `make`, channel ops require a core type. `[T ~[]int | ~[]string]` has no core type because the members have different underlying types.

### Q37. How do you express "a type that supports both `+` and `<`"?
**Short:** Embed `cmp.Ordered` (Go 1.21+).

**Long:** `cmp.Ordered` covers numeric and string types — all of which support both `+` and `<`. So `[T cmp.Ordered]` automatically authorises both operators (for those types where they are defined). For custom needs, write a union: `~int | ~float64 | ~string`.

### Q38. What is a "negative constraint" and why does Go not have it?
**Short:** A constraint that excludes specific types. Go has no such mechanism.

**Long:** You cannot say "any type that is not a slice". The spec only supports positive descriptions: type terms, unions, methods. The team rejected negative constraints to keep the type-set algebra simple. Workaround: enumerate positively or use a different design.

### Q39. Compare `[T any]`, `[T comparable]`, and `[T cmp.Ordered]` in terms of expressiveness.
**Short:** Increasing strictness, increasing operations available.

**Long:** `any` admits every type but allows almost no operations. `comparable` admits comparable types and authorises `==`/`!=`. `cmp.Ordered` admits a smaller set (numerics + strings) and authorises ordering. Each tightening narrows the type set and expands the body's vocabulary.

### Q40. Are there future directions for Go constraints?
**Short:** Discussions around tighter type inference, better error messages, and possibly negative constraints.

**Long:** The Go team has hinted at improved inference (less manual instantiation), better diagnostics for empty type sets, and broader stdlib constraints (perhaps `Numeric`, `Integer`). Negative constraints have been discussed but not accepted. Profile-guided optimization may also drive automatic specialization for tight constraints.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. The most common interview themes are:

- **Constraint = interface** (the structural identity)
- **Type sets** as the unifying concept
- **`~T` vs `T`** (the tilde matters)
- **Union vs intersection** in type elements
- **The Go 1.20 `comparable` change**
- **Core types** and what they enable
- **Constraint API design** (loose first, tighten later)
- **`golang.org/x/exp/constraints` → `cmp.Ordered`** migration

A confident candidate explains the **set algebra** behind constraints — not just the syntax.
