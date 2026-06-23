# Recursive Type Constraints — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What is a recursive type constraint?
**Short:** A constraint where a type parameter `T` is bounded by an interface that mentions `T` itself.

**Long:** Example: `type Cloner[T any] interface { Clone() T }`. Used as `func F[T Cloner[T]]`. The constraint refers back to T to express "T must have a method that returns its own type".

### Q2. What is F-bounded polymorphism?
**Short:** The academic name for "T is bounded by an interface parameterised by T".

**Long:** Coined in a 1989 paper. Languages like Java (`<T extends Comparable<T>>`), C#, Scala, and Kotlin all support it. Go inherits the pattern implicitly through generic interfaces being usable as constraints.

### Q3. Give the canonical recursive constraint example.
**Short:** `type Cloner[T any] interface { Clone() T }` used as `func DupAll[T Cloner[T]](xs []T) []T`.

### Q4. Why is `Cloner[T]` better than a non-generic `Cloner` interface?
**Short:** It preserves the concrete type. A non-generic `Clone()` returning `Cloner` forces callers to assert.

**Long:** Without the recursion, the chain `Cloner.Clone().DoConcreteThing()` requires a type assertion. With the recursion, `T.Clone().DoConcreteThing()` keeps full access to T's methods.

### Q5. Can methods declare their own type parameters in Go?
**Short:** No.

**Long:** Methods only have access to the receiver type's parameters. To use a recursive constraint at the method level, push the operation into a free function.

### Q6. Where does the constraint mention T twice?
**Short:** Once in `[T C[T]]` for the parameter, once for the constraint argument.

**Long:** `[T Cloner[T]]`: the first `T` is the parameter being declared, the second `T` is its argument to the constraint interface. They are the same variable.

### Q7. What method does `Cloner[T]` require?
**Short:** `Clone() T`.

### Q8. Is `[T Cloner[T]]` recursive at runtime?
**Short:** No. It is a compile-time pattern only.

**Long:** The compiler substitutes the concrete type once. There is no runtime recursion or infinite expansion.

### Q9. Give a non-Cloner example of a recursive constraint.
**Short:** `type Comparable[T any] interface { CompareTo(other T) int }`.

**Long:** Used as `func Sort[T Comparable[T]](xs []T)`. Each T can compare against other Ts of the same type.

### Q10. What does "self-bound" mean?
**Short:** Same as recursive bound — the constraint mentions the parameter being constrained.

---

## Mid-level 🟡

### Q11. Why does `func DupAll[T Cloner[any]]` not solve the same problem?
**Short:** `Cloner[any].Clone()` returns `any`, not `T`. The caller loses the type.

**Long:** With `Cloner[any]`, calling `v.Clone()` gives an `any`. Assigning back into `[]T` requires assertion. The whole point of the recursion is to make `Clone()` return `T`.

### Q12. How does type inference handle `[T Cloner[T]]`?
**Short:** Inference picks T from the function arguments, then substitutes into the constraint and checks satisfaction.

**Long:** For `DupAll(myFoos)`: argument type `[]Foo` pins `T = Foo`. The constraint becomes `Foo Cloner[Foo]`. Check Foo's method set. If `Clone() Foo` is present, the call compiles.

### Q13. When does inference fail for recursive constraints?
**Short:** When a type parameter appears only inside the constraint and no argument pins it.

**Long:** For `func F[A Pairable[A, B], B any](xs []A)`: A is inferred from xs, but B is only in the constraint. The compiler attempts constraint type inference using A's `Pair` method signature; if that fails, you must instantiate explicitly.

### Q14. Can you have two-parameter recursive constraints?
**Short:** Yes — `[A Pairable[A, B], B any]` for example.

**Long:** Recursion does not have to be on a single parameter. Multi-parameter F-bounds are allowed; inference is more fragile.

### Q15. Why must the recursive method return T directly, not the interface?
**Short:** If it returned the interface, the caller would lose the concrete type.

**Long:** `Clone() Cloner[T]` is legal but defeats the purpose. The point of the recursion is `Clone() T`.

### Q16. What is the difference between `[T Cloner[T]]` and `[T Cloner[*T]]`?
**Short:** Different type sets. The first requires `Clone() T`; the second requires `Clone() *T`.

**Long:** Pointer vs value receivers come into play. Choose based on whether the implementation method has pointer or value receivers.

### Q17. What is the simplest recursive constraint that the spec accepts?
**Short:** `[T any]` is non-recursive. The simplest recursive form is `[T C[T]]` where C is a one-method generic interface.

### Q18. Compare recursive constraints vs `cmp.Ordered`.
**Short:** `cmp.Ordered` is non-recursive and works for primitive-shaped types. Recursive `Comparable[T]` works for any type with a `CompareTo` method.

**Long:** Use `cmp.Ordered` for ints/floats/strings. Use recursive `Comparable[T]` for domain types (`Money`, `Date`, etc.) where the ordering is method-driven.

### Q19. Can a recursive constraint also embed `comparable`?
**Short:** Yes — intersection of constraints is allowed.

**Long:**
```go
type EqualCloner[T any] interface {
    comparable
    Clone() T
}
```
T must satisfy both: be comparable AND have `Clone() T`.

### Q20. Why are recursive constraints rare in beginner Go code?
**Short:** They are conceptually advanced and usually not necessary for application code.

**Long:** Most Go programs are concrete. Recursive constraints help library authors writing reusable abstractions. Application code rarely needs them.

---

## Senior 🔴

### Q21. What is the depth limit on recursive constraints in Go?
**Short:** One layer of self-reference. Deeper nesting causes compiler errors or unreadable diagnostics.

**Long:** `[T C[T]]` is fine. `[T C[C[T]]]` compiles syntactically but is hard to satisfy and produces confusing error messages. The Go team chose decidable type checking, so genuinely deep recursion is forbidden.

### Q22. Why are recursive constraints not put on methods directly?
**Short:** Methods cannot have their own type parameters in Go.

**Long:** A method on a generic type uses the type's parameters. To add a constraint just for one operation, write it as a free function. This is the idiomatic workaround.

### Q23. What do you do when a recursive constraint's inference fails?
**Short:** Instantiate explicitly: `F[T1, T2](args)`.

**Long:** Or refactor to put more type info in the function arguments. Sometimes adding a dummy parameter that pins the type is cleaner than living with explicit instantiation.

### Q24. Are recursive constraints stable as a public API?
**Short:** No. Adding a method to a recursive constraint breaks every implementer.

**Long:** Treat recursive interfaces like sealed contracts. Once exported, do not modify. Use a major version bump if you must change the method set.

### Q25. How do you document a recursive constraint for users?
**Short:** Provide a worked example in godoc showing a concrete type that satisfies the constraint.

**Long:** F-bounded polymorphism is unfamiliar. A snippet like `type User struct{...}; func (u User) Clone() User {...}` followed by `DupAll([]User{...})` saves readers ten minutes of confusion.

### Q26. Compare recursive constraints in Go vs Java.
**Short:** Both implement F-bounded polymorphism. Java uses `<T extends Comparable<T>>`; Go uses `[T C[T]]`. Both reject deep recursion.

**Long:** Java has explicit subtyping; Go has structural satisfaction. Java's wildcards add expressivity Go does not have. But the basic pattern — "method returns my type" — is the same.

### Q27. What is the hidden cost of recursive constraints?
**Short:** Cognitive load on readers and confusing error messages.

**Long:** No runtime cost (the compiler stencils as usual). The cost is **human**: reviewers, junior engineers, maintainers all spend time decoding the constraint. Compiler errors on a missing or wrong-typed `Clone` method can be hard to read.

### Q28. Could you implement a recursive constraint without making the interface generic?
**Short:** No. The `T` in the constraint must be a parameter of the interface.

**Long:** Without the parameter, you would have a non-generic `interface { Clone() Cloner }`, which is the very pattern recursive constraints are meant to replace.

### Q29. How does the compiler avoid infinite expansion?
**Short:** Substitution is one-shot — it replaces the parameter once and stops.

**Long:** Each `[T C[T]]` triggers exactly one substitution: `T → concrete`. The result is a concrete interface like `C[Foo]`, which has no further `T` to substitute. No fixed-point computation is needed.

### Q30. What design alternatives exist for recursive constraints?
**Short:** Plain interfaces (lose type), typestate types (gain stage safety), codegen (gain everything but lose flexibility).

**Long:**
- **Plain interface returning interface** — simpler, callers assert.
- **Distinct types per stage** — `OrderDraft` → `SubmittedOrder`, no generics, compile-time enforced.
- **Codegen** — generate per-type files; old-school but reliable.

Choose based on team familiarity and the abstraction's lifespan.

---

## Expert 🟣

### Q31. Why doesn't Go have a `this.type` keyword?
**Short:** Go avoids special syntax when an existing feature can simulate the same thing.

**Long:** Languages like Scala have `this.type`. Go could have added `Self` as a keyword, but recursive constraints achieve the same effect using existing generics. Less syntax, less new mental model.

### Q32. How do recursive constraints interact with GC shape stenciling?
**Short:** They don't, beyond the normal generic instantiation rules.

**Long:** The compiler still groups types by GC shape and produces one body per shape. The recursion is resolved at type-check time; by codegen time, T is concrete. So no extra dictionary cost beyond what any generic incurs.

### Q33. Walk through inference for `func F[A C[A, B], B any](a A) B` called with `F(myFoo)`.
**Short:** Infer A from the argument, then constraint type inference tries to derive B from A's method on `C`.

**Long:**
1. From `myFoo`, A = Foo.
2. Substitute: `Foo C[Foo, B]`. Compiler must find B such that Foo's `C` method matches.
3. Look at Foo's method matching `C`'s shape. Suppose Foo has `Method(other Foo) Bar`. Match: `B = Bar`.
4. If no unique match, inference fails.

### Q34. What surprises do recursive constraints cause for `pprof`?
**Short:** None. The stenciled body has the usual `[go.shape.X]` suffix.

**Long:** From `pprof`'s perspective, a function instantiated under a recursive constraint is just another generic function. The recursion does not appear in the symbol name.

### Q35. Compare recursive constraints in Go 1.18 vs Go 1.21+.
**Short:** Inference improved significantly in 1.21, especially constraint type inference.

**Long:** In 1.18-1.20 many recursive-constraint calls required explicit instantiation. 1.21 made constraint type inference smarter so more calls work without explicit type args. Subsequent releases continue to refine.

### Q36. Could recursive constraints work without generic interfaces?
**Short:** No. The recursion requires the constraint to be parameterised so it can mention T.

**Long:** A non-generic interface has no slot for T. Without the slot, there is nothing to refer back to. Generic interfaces are the mechanism that makes recursion expressible.

### Q37. Why is `comparable` not naturally recursive?
**Short:** `comparable` is a fixed predeclared constraint that does not take type parameters.

**Long:** `comparable` is parameterless. It says "T supports `==`/`!=`". You can intersect it with a recursive interface (`comparable; Clone() T`) but `comparable` itself does not participate in the recursion.

### Q38. How would you debug a "T does not satisfy C[T]" error?
**Short:** Substitute manually. Write out the instantiated interface and check the method set of T against it.

**Long:** Write `T = Foo`. The constraint becomes `interface{ Clone() Foo }`. Look at `Foo`'s methods. Often the issue is wrong receiver type (value vs pointer) or wrong return type (`Cloner` vs `Foo`).

### Q39. What is the relationship between recursive constraints and typestate?
**Short:** Recursive constraints keep the type the same. Typestate changes the type per stage.

**Long:** Typestate is "method moves you to a new type". Recursive bounds are "method returns the same type". Different concepts. Some languages combine them; Go supports recursive bounds but does not have typestate as a first-class feature.

### Q40. Could Go ever support deeper recursion in constraints?
**Short:** Possibly, but the team has not committed to it.

**Long:** Deeper recursion would require more sophisticated constraint solving, which slows the compiler. The Go team has been conservative — adding only what users genuinely need. Deeper recursion is on the wishlist for some, but no concrete proposal has been accepted.

---

## Summary

Memorize the **short answers** for fluency. Common interview themes:

- The canonical example (`Cloner[T]`)
- Why the recursion preserves the concrete type
- Methods cannot have their own type parameters → free functions
- Inference limits and explicit instantiation
- F-bounded polymorphism in academic vs practical sense
- Comparison with Java/Scala/Kotlin
- When NOT to use recursive constraints

A confident candidate explains **the why**: the recursion exists because Go has no `this.type` keyword, and generic interfaces give us the same expressive power.
