# Generic Type Aliases — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. All answers are for Go 1.24, where generic type aliases are fully supported by default.

---

## Junior

### Q1. What is a generic type alias?

**Model answer.** It is a type alias that takes type parameters. A plain alias (`type Bytes = []byte`) gives a second name to an existing type. A *generic* alias adds type parameters: `type Set[T comparable] = map[T]struct{}`. You instantiate it like any generic type — `Set[string]` — and `Set[string]` is *identical* to `map[string]struct{}`. The `=` means it is a synonym, not a new type. It was fully enabled by default in Go 1.24.

**Common wrong answers.**
- "It's a new generic type." (No — an alias creates no new type; it denotes its right-hand side.)
- "It's the same as `type Set[T comparable] map[T]struct{}`." (No — that form, without `=`, defines a *new* type that can have methods.)
- "It works in any recent Go version." (No — generic aliases are a Go 1.24 feature.)

**Follow-up.** *Is `Set[int]` assignable to `map[int]struct{}`?* — More than assignable: they are *identical*, so no conversion is needed.

---

### Q2. What is the difference between `type A = B` and `type A B`?

**Model answer.** `type A = B` is an *alias*: A is another name for B; they are the same type, interchangeable with no conversion, and A cannot have its own methods. `type A B` is a *type definition*: A is a new, distinct type whose underlying type is B; you must convert to go between A and B, and you *can* declare methods on A. Go 1.24 lets *both* forms take type parameters.

**Follow-up.** *Which one would you use to make a `UserID` that the compiler keeps separate from a raw `int`?* — `type UserID int` (a defined type). An alias would make `UserID` interchangeable with `int`, defeating the purpose.

---

### Q3. Can you declare a method on a generic alias?

**Model answer.** No. An alias is not a defined type, and Go only allows methods on defined types declared in the same package. Writing `func (s Set[T]) Add(v T) {}` for `type Set[T comparable] = map[T]struct{}` is a compile error. If you need methods, drop the `=` to make a defined type: `type Set[T comparable] map[T]struct{}`.

**Common wrong answer.** "Yes, if you instantiate it first." (No — instantiation does not create a defined type; the receiver is still illegal.)

**Follow-up.** *Why is the rule like that?* — Methods attach to a named defined type; an alias only denotes another type, so there is nothing to attach a method to. Substituting the alias yields a composite literal like `map[...]...`, which is not a valid receiver.

---

### Q4. Why must `type Set[T comparable] = map[T]struct{}` use `comparable` and not `any`?

**Model answer.** Because the right-hand side is a map, and map keys must be comparable. The alias's constraint must be at least as strong as the RHS requires. `type Set[T any] = map[T]struct{}` does not compile — it would permit non-comparable keys. You may use a *stronger* constraint (e.g. `cmp.Ordered`), but not a weaker one.

**Follow-up.** *Where is this checked — declaration or use?* — Both. The declaration is rejected if the constraint is too weak for the RHS; each instantiation is checked against the alias's constraint.

---

### Q5. Does a generic alias add runtime overhead?

**Model answer.** None. It is resolved entirely at compile time. `Set[int]` *is* `map[int]struct{}` in the compiled program — no wrapper, no indirection, no allocation. At runtime, reflection even reports the resolved type (`map[int]struct {}`), not the alias name.

**Follow-up.** *So can you tell at runtime that a value came through the alias?* — No. The alias does not exist at runtime; reflection sees the underlying type.

---

## Middle

### Q6. When would you choose an alias over a defined generic type?

**Model answer.** Choose an alias when you want a *transparent name* that preserves type identity: shortening a verbose generic literal, re-exporting another package's generic type, or providing a migration shim. Choose a defined type when you need *behavior or distinctness*: methods, a privacy/encapsulation boundary, or unit safety where the compiler must keep the type separate from its underlying structure.

The heuristic: alias for naming + identity; defined type for behavior + distinctness.

**Follow-up.** *Give a concrete case where the identity property is the whole point.* — Re-exporting `internal/cache.Cache[K,V]` as `store.Cache[K,V]` so the two are the same type and values flow without conversion.

---

### Q7. How does a generic alias help re-export a type from another package?

**Model answer.** You write `type Cache[K comparable, V any] = cache.Cache[K, V]`. Because the alias preserves identity, `store.Cache[string,int]` is *identical* to `cache.Cache[string,int]`, and the method set transfers (it comes from the RHS, which is a defined type with methods). Before Go 1.24 you could not parameterize a re-export, so you used a wrapper defined type — which created a *distinct* type, breaking interop and forcing conversions or manual method forwarding.

**Common wrong answer.** "The alias copies the methods over." (Not quite — the alias has no methods of its own; it *names* a type that already has them, so the method set is the RHS's.)

**Follow-up.** *Do you also need to re-export the constructor?* — Yes, if construction needs the source package. Aliasing the type does not grant construction privileges; re-export `New` as a function.

---

### Q8. Are `Set[int]` and `map[int]struct{}` the same type or merely assignable?

**Model answer.** The same type — *identical*. No conversion is needed in either direction. This is stronger than assignability. A consequence: a type switch cannot distinguish them, and a `case Set[int]:` plus `case map[int]struct{}:` in one switch is a duplicate-case error.

**Follow-up.** *What about `type C[K,V] = pkg.Cache[K,V]` — is `C[string,int]` identical to a struct of the same shape?* — No. When the RHS is a *defined* type, identity is by name: `C[string,int]` is identical to `pkg.Cache[string,int]`, not to an anonymous struct of the same layout.

---

### Q9. Can a generic alias reference another generic alias?

**Model answer.** Yes — `type Boxed[T any] = Result[T]` where `Result[T] = struct{ Value T; Err error }`. Each layer resolves by substitution until a non-alias type is reached. The chain must terminate; a cycle (`A → B → A`) is a compile error ("invalid recursive type alias"). Identity is computed on the final resolved type, so `Boxed[int]`, `Result[int]`, and the raw struct are all the same type.

**Follow-up.** *Why is a recursive defined type allowed but a recursive alias not?* — A defined type's *name* breaks the cycle and gives a finite reference point; an alias only denotes, so substitution never terminates.

---

### Q10. What is the version timeline for this feature?

**Model answer.** Type aliases arrived in Go 1.9 without generics. Generics arrived in Go 1.18, but parameterized aliases were deliberately deferred (proposal #46477). Go 1.23 shipped *experimental, partial* support behind `GOEXPERIMENT=aliastypeparams`. Go 1.24 made them **fully supported and on by default**. Target 1.24 and set `go 1.24` in `go.mod`.

**Common wrong answer.** "They shipped with generics in 1.18." (No — they were explicitly left out of 1.18 and finalized in 1.24.)

**Follow-up.** *Should you rely on the 1.23 experiment?* — No. It was a stepping stone, off by default and outside the compatibility promise. Use 1.24.

---

### Q11. How does type inference behave through a generic alias?

**Model answer.** Inference sees through the alias to its resolved RHS. For `type Slice[T any] = []T` and `func head[T any](s Slice[T]) T`, calling `head([]int{1,2,3})` infers `T = int` because `Slice[T]` resolves to `[]T` and `[]int` unifies with `[]T`. The alias neither adds inference variables nor blocks inference; it is just a substitution step. If inference would succeed against the resolved type, it succeeds through the alias; if it would fail, the alias does not help.

**Follow-up.** *Does aliasing a defined generic type change inference?* — No. Inference unifies against the named type the alias denotes, exactly as if you had written that named type directly.

---

### Q12. What constraints can you put on an alias relative to its RHS?

**Model answer.** The alias's constraints must be **at least as strong** as the RHS requires. You can strengthen (`cmp.Ordered` where `comparable` would do), which narrows callers. You cannot weaken — declaring `any` for a map-key parameter fails at declaration. When re-exporting, the safe move is to copy the RHS's constraints verbatim. Note that if the RHS uses an *unexported* constraint from another package, you cannot name it at a re-export site.

**Follow-up.** *Design implication for library authors?* — Use exported, nameable constraints on types you expect others to re-export, so a verbatim alias is always possible.

---

## Senior

### Q13. You're moving a generic type to a new package without breaking callers. Walk me through it.

**Model answer.**
1. Define (or move) the type in its new home: `package core; type Widget[T any] struct {...}`.
2. In the old package, leave an identity-preserving alias: `type Widget[T any] = core.Widget[T]`, tagged `// Deprecated: moved to core`.
3. Because the alias preserves identity, every existing `legacy.Widget[Foo]` value is the *same type* as `core.Widget[Foo]`. Functions taking either accept both. Nothing breaks.
4. Migrate call sites incrementally — no flag day.
5. Remove the alias in a later major version once telemetry/grep shows it is unused.

The key property is identity-preservation: there is never a "two incompatible types" window that a wrapper type would create.

**Follow-up.** *Is adding the alias a breaking change? Removing it?* — Adding is non-breaking (additive name). Removing is breaking (deletes an exported name) and belongs in a major version.

---

### Q14. When is an alias the *wrong* choice for re-export, and what do you use instead?

**Model answer.** Use a defined wrapper type, not an alias, when the public API must be *insulated* from the internal type's evolution. An alias welds the public name to the internal type — any change to the internal shape is immediately visible through the public name, and the two are the same type. If you need freedom to refactor the internals without affecting the public contract, define a wrapper:

```go
type Cache[K comparable, V any] struct{ impl internal.Cache[K, V] }
```

and forward methods explicitly. You trade identity (now distinct) and boilerplate for insulation. So: alias for a *thin* facade where the internal type *is* the intended contract; wrapper when the public surface must evolve independently.

**Follow-up.** *What does an alias leak that a wrapper hides?* — The target package and type, visible in `go doc` and at the reflection layer. An alias cannot hide the source package.

---

### Q15. What transfers across an alias at a package boundary, and what doesn't?

**Model answer.** Transfers (identity is preserved): the full method set of the RHS, the RHS's constraints, assignability/identity (no conversion), and the underlying structure including field names and tags.

Does *not* transfer / is unchanged: `internal/` access rules (you still cannot reach unexported members), the visibility of the alias *name* (a lowercase alias name is package-private regardless of the RHS), and the ability to add methods (you cannot extend through an alias). A common mistake is assuming the alias re-grants construction privileges — it does not; re-export the constructor explicitly.

**Follow-up.** *If the RHS type has only unexported fields and no exported constructor, can callers of the aliasing package build one?* — No. They must use the source package's constructor; the alias only renames the type.

---

### Q16. What are the compatibility implications of adopting generic aliases in a public API?

**Model answer.** Two layers. First, the feature itself imposes a **Go 1.24 minimum** on all consumers — adopting it in exported API is a minimum-toolchain bump, which for a widely-used library is a real adoption decision. Set the `go` directive to `go 1.24` so consumers get a clean version error. Second, swapping a public type between an *alias* and a *defined type* of the same structure is potentially **breaking**, because it changes type *identity* — reflection, type switches, and callers relying on identity with the RHS are affected, even though the structural shape is unchanged.

**Follow-up.** *Is replacing a defined type with an alias of an identically-shaped type safe for callers?* — For assignability, usually yes (identity with the new RHS is gained). But reflection-based code reading the type's name/package may change behavior, and identity with the *old* defined type is lost. Treat such swaps as risky on public types.

---

### Q17. Why can't an alias enforce invariants, and when does that matter?

**Model answer.** An alias has no methods and no privacy boundary — it is transparent to the RHS. So you cannot use it to guarantee "this value is always validated/non-nil." Anyone can construct the underlying type directly and get a value indistinguishable from one that went through your "constructor." Enforcing invariants requires a *defined* type with unexported fields, a constructor, and methods that maintain the invariant. This matters for domain types (validated IDs, non-empty collections, money types) where the compiler must prevent constructing an invalid value. For those, never use an alias.

**Follow-up.** *Could you combine an alias for the friendly name with a defined type for safety?* — No — they are mutually exclusive for one declaration. Pick the defined type when safety matters; the friendly name is then the defined type's name.

---

### Q18. You're writing a static-analysis tool that reasons about types including generic aliases. What do you need to handle?

**Model answer.** In `go/types`, generic aliases are modeled as `types.Alias`, with `Rhs()` returning what they denote and `TypeParams()`/`TypeArgs()` exposing the generics. The critical rule: **`Unalias` before reasoning about identity, assignability, or method sets**, otherwise two values that are identical at runtime appear different because one is wrapped in a `types.Alias`. Keep the alias wrapper only when your output is source-facing (diagnostics, doc generation, refactorings that should preserve the author's chosen name). Resolve it when your logic is semantics-facing. Also build with a Go 1.24+ toolchain so `go/types` recognizes the generic-alias form.

**Follow-up.** *What's the single most common bug in such tools?* — Forgetting to `Unalias`, so `types.Identical` returns false for types that are actually the same.

---

## Staff / Architect

### Q19. Design the deprecation lifecycle for renaming an exported generic type across a major library.

**Model answer.**
1. **Introduce** the new name as the real type (or move it to a new package).
2. **Alias the old name** to the new one, identity-preserving, with a `// Deprecated:` doc comment (so `staticcheck`/`go vet` warn downstream).
3. **Announce** in release notes; ship as a *minor* version (additive, non-breaking).
4. **Hold** for at least one release cycle per your compatibility policy. Throughout, old and new names are the *same type*, so no caller faces an incompatible-type window.
5. **Measure** usage (telemetry, code search across known consumers).
6. **Remove** the alias in the next *major* version (deleting an exported name is breaking).

The alias absorbs the compatibility burden and decouples the rename from call-site updates. The risk to manage: aliases that never get removed become permanent coupling — schedule and track removal.

**Follow-up.** *How does this differ if you'd used a wrapper type instead of an alias?* — A wrapper creates a *distinct* type, so during the transition old and new are incompatible, forcing a flag-day migration or manual conversions. The alias avoids that entirely.

---

### Q20. A team wants to use aliases like `type UserID = int64` and `type OrderID = int64` for clarity. Critique this.

**Model answer.** This is a misuse. Because both are aliases, `UserID`, `OrderID`, and `int64` are all the *same type* — fully interchangeable. The compiler will happily let you pass an `OrderID` where a `UserID` is expected, or do arithmetic mixing them. The "clarity" is documentation-only and provides no safety. If the goal is to prevent mixing identifiers, use *defined* types: `type UserID int64`, `type OrderID int64`. Then the compiler enforces the distinction (conversions required to mix). Aliases are for *erasing* a distinction (re-export, migration, naming a shared shape), not creating one.

**Follow-up.** *When is `type Celsius = float64` (an alias) actually appropriate?* — When you genuinely want interchangeability with `float64` and only seek a readable name, e.g. in a thin wrapper or re-export. If you want unit safety (no mixing Celsius and Fahrenheit), use a defined type.

---

### Q21. How do generic aliases interact with reflection and runtime type identity, and why does it matter architecturally?

**Model answer.** At runtime the alias does not exist — the binary contains only the resolved type. `reflect.TypeOf(Set[int]{})` reports the underlying map; `reflect.TypeOf(C[string,int]{})` for `type C[K,V] = pkg.Cache[K,V]` reports `pkg.Cache[...]` with `PkgPath` pointing at `pkg`, *not* at the aliasing package. Architecturally this means:
- Serialization/registry systems keyed on `reflect.Type.Name()`/`PkgPath()` see through the alias. You cannot "rebrand" a type via an alias for the benefit of such systems.
- Plugin or DI frameworks that register types by reflected identity will treat the alias and its RHS as one — usually what you want, occasionally surprising.
- If a design depends on a *distinct* runtime identity (separate registration), you need a defined type, not an alias.

**Follow-up.** *Does the same apply to non-generic aliases?* — Yes. `type Bytes = []byte` reflects as `[]uint8`. Generic aliases add parameters but no runtime presence.

---

### Q22. When designing a library type you expect downstream packages to re-export via alias, what do you do differently?

**Model answer.**
1. **Use exported, nameable constraints** (`comparable`, `any`, `cmp.Ordered`, or your own *exported* constraint interfaces) so a verbatim alias is possible. An unexported constraint cannot be named at a re-export site.
2. **Export a constructor** so the aliasing package's callers can build values without reaching unexported fields.
3. **Keep the public method set stable**, since it transfers through every alias — changing it ripples to all re-exporting packages.
4. **Document the type as re-export-friendly** and pin the Go 1.24 floor.
5. **Avoid embedding unexported types** in the public surface in ways that complicate re-export.

The principle: the alias preserves identity and method set, so your type's *public* surface and *constraint* choices become the contract every re-exporter inherits.

**Follow-up.** *What breaks a downstream verbatim alias most often?* — An unexported constraint interface on a type parameter; the re-exporter cannot name it.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| New type or synonym? | Synonym — denotes the RHS. |
| Methods allowed on it? | No. |
| `Set[int]` vs `map[int]struct{}`? | Identical. |
| Default-on since Go version? | 1.24. |
| Experiment flag in 1.23? | `GOEXPERIMENT=aliastypeparams`. |
| Constraint can be weaker than RHS? | No — at least as strong. |
| Runtime overhead? | None. |
| Cyclic aliases? | Compile error. |
| Re-export preserves identity? | Yes. |
| Reflection sees the alias? | No — the resolved type. |

---

## Mock Interview Pacing

A 30-minute interview on generic type aliases might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q8, Q11.
- 15–25 min: a senior scenario — Q13, Q14, or Q17.
- 25–30 min: a curveball — Q20 (the `UserID` misuse) or Q21 (reflection).

If the candidate claims Go 1.24 experience, drive straight to Q7 (re-export) and Q14 (alias-vs-wrapper) — both separate people who *used* the feature from people who *read about* it. If they only read about it, stay in middle territory and probe identity (Q8) and the no-methods rule (Q3). A staff candidate should reach the deprecation-lifecycle design (Q19) within fifteen minutes and should immediately flag the `UserID` alias (Q20) as a misuse.
