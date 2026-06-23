# Generic Type Aliases — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. In a real interview, give the short version first and expand only if asked.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What is the difference between `type X = Y` and `type X Y`?
**Short:** `type X = Y` is an alias — same type, second name. `type X Y` is a defined type — new identity, no methods inherited.

**Long:** `type Celsius = float64` makes `Celsius` literally `float64`; you can pass either where the other is expected, and you cannot declare new methods on it. `type Celsius float64` creates a brand-new type with `float64` as the underlying representation; you can add methods to it, and assignment between `Celsius` and `float64` requires a conversion.

### Q2. When were generic type aliases added to Go?
**Short:** Go 1.24, February 2025.

**Long:** Generic aliases were originally requested in issue 46477 in 2021 alongside the generics design. They were prototyped behind `GOEXPERIMENT=aliastypeparams` in Go 1.22 and 1.23, then enabled by default in 1.24.

### Q3. Can you declare methods on a generic type alias?
**Short:** No.

**Long:** Aliases cannot carry methods. The compiler rejects with "cannot define new methods on non-local type". This rule has applied to all aliases since 1.9 and was not changed for generic aliases.

### Q4. What does `type Vec[T any] = []T` mean?
**Short:** `Vec[T]` is another name for `[]T` for every concrete `T`.

**Long:** It declares `Vec` as a parameterised alias. `Vec[int]` is identical to `[]int`, `Vec[string]` is identical to `[]string`, and so on. No new type is created — only a second name for an existing one.

### Q5. Why would I want a generic alias?
**Short:** Re-export, migration, or a friendly local name.

**Long:** The killer use case is re-exporting another package's generic type so callers can use a name from your package while values flow seamlessly to the original. Migrations between packages also benefit, and shorter local names are a minor convenience.

### Q6. What is `GOEXPERIMENT=aliastypeparams`?
**Short:** A 1.22 / 1.23 flag that enabled generic aliases before they were default in 1.24.

**Long:** Go uses environment-variable experiments to gate in-development language features. Setting this variable on Go 1.22 or 1.23 made the compiler accept `type Vec[T any] = []T`. From 1.24 onward, the flag is a no-op.

### Q7. Are `Vec[int]` and `[]int` the same type if `Vec` is a generic alias?
**Short:** Yes.

**Long:** Identity is preserved. Functions accepting `[]int` accept `Vec[int]`; type assertions, type switches, and reflection all see them as the same type.

### Q8. Give a one-line example of a generic alias.
**Short:** `type StringMap[V any] = map[string]V`.

### Q9. Can a generic alias have constraints?
**Short:** Yes, the same way generic types and functions can.

**Long:** `type Set[T comparable] = map[T]struct{}` declares an alias whose type parameter must be `comparable`. The constraint must be at least as strict as that of the right-hand side.

### Q10. Does a generic alias cost anything at runtime?
**Short:** No. Aliases are erased at compile time.

**Long:** The compiler resolves the alias to its underlying type during type checking. No new code, no new dictionary, no new symbol. The runtime sees only `[]int`, never `Vec[int]`.

---

## Mid-level 🟡

### Q11. Why was generic aliasing forbidden between 1.18 and 1.23?
**Short:** The 1.18 generics design left it as future work; it took until 1.24 to land cleanly.

**Long:** The original Type Parameters Proposal explicitly listed parameterised aliases as a TODO. The 1.18 team prioritised shipping the core feature. Issue 46477 tracked the design discussion; the experiment landed in 1.22 and graduated in 1.24.

### Q12. Show a workaround used pre-1.24 to "re-export" a generic type.
**Short:** A defined type or wrapper struct.

**Long:**
```go
// Defined type (loses methods)
type List[T any] bar.List[T]

// Wrapper (forwards methods manually)
type List[T any] struct {
    inner bar.List[T]
}
func (l *List[T]) Append(v T) { l.inner.Append(v) }
```
Both change the type's identity, breaking backward compatibility. Generic aliases solve this in one line.

### Q13. Why does the constraint of an alias have to match its right-hand side?
**Short:** Otherwise the compiler could not guarantee the right-hand side is well-formed for every type argument.

**Long:** If `bar.Set[T comparable]` requires `comparable` and you write `type Set[T any] = bar.Set[T]`, then a caller could pass `T = []int` (not comparable) and `bar.Set[T]` would be ill-formed. The compiler refuses the alias declaration up front.

### Q14. What happens during reflection on an aliased type?
**Short:** Reflection sees the underlying type's name, not the alias.

**Long:** `reflect.TypeOf(Vec[int]{1,2,3}).String()` returns `[]int`, not `Vec[int]`. Aliases are compile-time only and do not appear in runtime type descriptors.

### Q15. Can you embed an aliased struct?
**Short:** Yes — embedding works because the alias is the same type.

**Long:**
```go
type Renamed = SomeStruct
type Outer struct { Renamed }
```
The fields and methods of `SomeStruct` are promoted into `Outer` exactly as if you had embedded `SomeStruct` directly.

### Q16. What is the difference between aliasing and defining a type with the same underlying?
**Short:** Identity. Alias preserves it; defined type breaks it.

**Long:** `type Vec[T any] = []T` keeps `Vec[int]` identical to `[]int`. `type Vec[T any] []T` creates a distinct type that has `[]int` only as its underlying type. The defined type can declare methods; the alias cannot.

### Q17. Give a real-world reason a library author would prefer an alias over a defined type.
**Short:** To re-export a generic type from another package without forcing callers to convert.

**Long:** Suppose `bar.List[T]` is the canonical generic list. You want your package `mypkg` to expose `List[T]`. With a defined type, callers using `bar.List[T]` and `mypkg.List[T]` would need conversions everywhere. An alias keeps both names interchangeable.

### Q18. Why does method-set-related code break under defined types but not aliases?
**Short:** Defined types have their own method sets, separate from the underlying type. Aliases share the underlying type's method set.

**Long:** A defined type does not inherit methods from its underlying type. So `type List[T any] bar.List[T]` has zero methods. An alias `type List[T any] = bar.List[T]` shares methods because the two names point to the same type.

### Q19. Explain the `type any = interface{}` predeclared alias.
**Short:** `any` is a non-generic alias for `interface{}`, predeclared in the universe block since Go 1.18.

**Long:** It is the prototype for all aliases — same identity, just a friendlier name. There are currently no predeclared **generic** aliases.

### Q20. Suppose you want to add a method to `bar.List[T]` from outside the package. Can you?
**Short:** No. Methods can only be declared in the package that owns the type. Aliases cannot bypass this rule.

**Long:** The Go compiler enforces this regardless of how you reference the type. The proper solution is to define a wrapper struct embedding `bar.List[T]` and add methods to the wrapper.

---

## Senior 🔴

### Q21. When should you NOT use a generic alias?
**Short:** When you need methods, when you need distinct identity, when the right-hand side is not stable.

**Long:** Methods require a defined type. Distinct identity is necessary for nominal typing (e.g., `Celsius` vs raw `float64`). And aliasing a type whose location or identity may change is fragile — a future refactor might break the alias chain.

### Q22. How do generic aliases interact with deprecation?
**Short:** They are the canonical mechanism for graceful deprecation of moved generic types.

**Long:** A `Deprecated:` comment plus an alias to the new home keeps callers compiling while signalling intent. `gopls` and linters render the deprecation strikethrough; over a couple of release cycles, callers migrate, and the alias can be removed.

### Q23. What happens if I alias a generic type then change the underlying type's signature?
**Short:** The alias declaration must be updated; otherwise the package fails to compile.

**Long:** If `bar.List[T]` changes to `bar.List[T comparable]`, every alias declaration referencing it must update too. The compiler treats alias declarations as ordinary type-level dependencies.

### Q24. How does a generic alias interact with `comparable`?
**Short:** It propagates the constraint just like any generic.

**Long:** `type Set[T comparable] = map[T]struct{}` declares `T` as `comparable`. Callers must instantiate with comparable types. The 1.20 relaxation that allowed interface types to satisfy `comparable` applies here too — the alias does not introduce its own rules.

### Q25. Could a generic alias be used as a constraint?
**Short:** Sometimes — depends on the underlying type.

**Long:** If the alias resolves to an interface, it can be used as a constraint. If it resolves to a non-interface type, it cannot. The spec requires constraints to be interface types (with optional type elements).

### Q26. What is the design rationale for forbidding methods on aliases?
**Short:** Avoiding cross-package method ownership.

**Long:** If an alias in package `A` could declare methods on `B.X`, then importing `A` would silently extend `X`'s method set. That breaks the locality of method definitions, which Go relies on for clear, predictable behaviour. Forbidding the construct sidesteps the problem entirely.

### Q27. How does a senior engineer decide between alias, defined type, and wrapper struct?
**Short:** Identity for alias, ownership for defined type, behaviour for wrapper.

**Long:** Aliases preserve identity but cannot add behaviour. Defined types break identity and can add behaviour, but inherit no methods. Wrapper structs preserve the underlying behaviour through embedding while letting you add new behaviour. Each addresses a different concern; choose based on what you need to change.

### Q28. What is the canonical migration story enabled by generic aliases?
**Short:** Move a generic type between packages without breaking callers.

**Long:** Add the type at the new location, leave a `type X[T any] = newpkg.X[T]` alias at the old location, mark it `Deprecated:`. Callers compile unchanged, gradually migrate, and after two releases you remove the alias.

### Q29. Why do stdlib packages tend to use defined types for new generics rather than aliases?
**Short:** Stable, distinct identity for public API.

**Long:** The standard library prefers defined types because they create canonical names with their own identity. Aliases are mainly used internally for refactor work. For application code shipping public APIs, a defined type is usually the right choice unless you specifically need re-export behaviour.

### Q30. Can two generic aliases collide if they reach the same underlying type?
**Short:** No — they happily coexist, but readers will be confused.

**Long:** `type A[T any] = []T` and `type B[T any] = []T` are both valid. `A[int]` and `B[int]` are the same type as `[]int` and as each other. The compiler is fine with this. Code reviewers may not be — many synonyms for the same type signal poor naming hygiene.

---

## Expert 🟣

### Q31. Walk through what the compiler does when it sees `type Vec[T any] = []T`.
**Short:** Records the alias, substitutes `T` whenever instantiated, emits no new code.

**Long:** The parser recognises the alias declaration with type parameters. The type checker stores `Vec` as a parameterised alias for `[]T`. At every use site of `Vec[X]`, the type checker substitutes `T = X` into the right-hand side and produces `[]X`. Code generation operates on `[]X`; the alias name does not survive into the IR.

### Q32. How does this interact with GC shape stenciling?
**Short:** It does not. Aliases erase before stenciling decisions are made.

**Long:** GC shape stenciling groups generic instantiations by memory shape. Since the alias is resolved to its underlying type before code generation, the stenciling sees `[]int`, never `Vec[int]`. There is no separate stencil per alias.

### Q33. Could generic aliases cause incremental compilation surprises?
**Short:** Only if the underlying type changes — and the same applies to any type-level dependency.

**Long:** A change to `bar.List[T]`'s shape invalidates every package that references it, including any package that aliases it. The build cache handles this automatically. There are no extra invalidation rules for aliases.

### Q34. Why are there no predeclared generic aliases like `type Slice[T] = []T`?
**Short:** The Go team keeps the universe block minimal.

**Long:** Predeclared names compete for the global namespace and must be carefully chosen. The team has discussed adding convenience aliases for slices and maps but has consistently declined — the cost of polluting the universe outweighs the saved keystrokes. The community can define such aliases per project if desired.

### Q35. What are the trade-offs of a deeply nested alias chain?
**Short:** Compiles fine, harms readability, complicates static analysis.

**Long:** `type A = B; type B = C; type C = otherpkg.D` works but readers have to follow each link to understand the type. Static analysis tools resolve the chain, but error messages may show the most-resolved name rather than the alias the user wrote. As a rule of thumb, one level of aliasing is fine, two is a smell, three is an anti-pattern.

### Q36. Could parameterised aliases be used to implement higher-kinded type tricks?
**Short:** Not really — aliases are not a substitute for higher-kinded types.

**Long:** Some languages (Haskell, Scala) support type constructors as first-class. Go does not. A generic alias must list all its parameters explicitly; you cannot pass a type constructor around. Aliases simplify naming, not abstraction.

### Q37. How would you debug an "alias constraint mismatch" error?
**Short:** Read the error carefully — the compiler reports the conflicting constraints.

**Long:** The compiler will say something like:
```
type argument T does not satisfy comparable
```
Trace the alias's right-hand side; the underlying type required `comparable`, your alias declared `any`. Tighten the constraint.

### Q38. How do generic aliases interact with `iota` or constant declarations?
**Short:** They do not. Aliases declare types, not values.

**Long:** Constants are unrelated to type aliases. You can use an aliased type in a constant declaration (`const x Foo[int] = 0`) only if the underlying type permits it.

### Q39. Could the compiler one day specialize generic aliases differently from underlying types for performance?
**Short:** No reason to — they are the same type.

**Long:** Specialization decisions are based on the type, not the name used to refer to it. Even if the compiler became smarter about generic specialization, it would not differentiate `Vec[int]` from `[]int`. Both refer to the same instantiation.

### Q40. What is the most common mistake teams make when adopting generic aliases?
**Short:** Trying to add methods or wrap behaviour through an alias.

**Long:** New users assume the alias is a "lightweight new type". It is not — it is the same type. Any time you find yourself wanting to add a method, change a behaviour, or restrict accepted values, switch to a defined type or a wrapper struct. Forcing an alias to do what it cannot leads to compile errors that puzzle the team.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. The most common interview themes are:

- Difference between alias and defined type
- The 1.24 release and the `GOEXPERIMENT` window
- Identity preservation as the core property
- Why methods cannot be declared on aliases
- Re-export as the canonical use case
- Constraint matching between alias and underlying type
- Decision between alias / defined type / wrapper

A confident candidate explains **the why**, not just the syntax: what gap did the feature close, and what is it not?
