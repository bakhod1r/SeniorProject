# Simplifying Method Calls — Interview Q&A

> 50+ questions on the 14 techniques.

---

## Conceptual (Q1–Q14)

**Q1.** What does Rename Method do?
A. Gives a method a better name. Most-used IDE refactoring.

**Q2.** What does Add Parameter do?
A. Adds a new parameter when the method needs more information.

**Q3.** What does Remove Parameter do?
A. Removes an unused parameter.

**Q4.** What's Separate Query from Modifier?
A. A method returning a value should not have side effects. Split it.

**Q5.** What's Parameterize Method?
A. Combine several methods that differ by a constant into one with a parameter.

**Q6.** What's Replace Parameter with Explicit Methods?
A. Opposite of Parameterize: a parameter triggering different code paths becomes separate methods.

**Q7.** What's Preserve Whole Object?
A. Pass the whole object instead of a handful of its fields.

**Q8.** What's Replace Parameter with Method Call?
A. The caller passes a value the callee can compute itself.

**Q9.** What's Introduce Parameter Object?
A. Bundle related parameters into a value object.

**Q10.** What's Remove Setting Method?
A. Drop a setter for a field that should be immutable after construction.

**Q11.** What's Hide Method?
A. Make a method less visible (private, package).

**Q12.** What's Replace Constructor with Factory Method?
A. Replace `new Type(...)` with a static method that constructs and returns the instance.

**Q13.** What's Encapsulate Downcast?
A. Push a downcast inside the method that returns the value, eliminating it at all callers.

**Q14.** What's Replace Error Code with Exception, and the inverse?
A. Replace integer error codes with thrown exceptions for *exceptional* failures. Replace Exception with Test for *expected* errors.

---

## When to apply (Q15–Q30)

**Q15.** When is Add Parameter the wrong move?
A. When you'd be the 5th+ parameter — consider Introduce Parameter Object.

**Q16.** When does Remove Parameter break tests?
A. When tests passed the parameter to control behavior; check before removing.

**Q17.** When is Separate Query from Modifier wrong?
A. When the side effect is intrinsic (iterator next(), counter increment).

**Q18.** When does Parameterize Method overgeneralize?
A. When the variants are conceptually different operations, not values of one operation.

**Q19.** When should Replace Parameter with Explicit Methods apply?
A. When a boolean / enum parameter selects entirely different behavior, especially if callers always know statically.

**Q20.** When does Preserve Whole Object hurt?
A. When the callee doesn't need the whole object — overspecifies dependency, complicates testing.

**Q21.** When should you NOT Replace Parameter with Method Call?
A. When the computation is expensive and the caller already has the value cached.

**Q22.** When is Introduce Parameter Object overkill?
A. For 2-3 parameters that don't recur — overkill.

**Q23.** When is Remove Setting Method right?
A. For identifiers, immutable fields, anything set once at construction.

**Q24.** When is Hide Method the default?
A. Always — default to private; expand visibility only when needed.

**Q25.** When does Replace Constructor with Factory Method help?
A. Need a name (`Money.fromCents`), polymorphic creation, validation, or caching.

**Q26.** When is Encapsulate Downcast a smell rather than a fix?
A. When the type was wide for no reason; better to use generics or a narrower return type.

**Q27.** When are exceptions the right error mechanism?
A. When the failure is exceptional, rare, and hard to detect at the call site.

**Q28.** When should errors be values (return code, Result type)?
A. When failures are expected, frequent, or part of normal flow; performance-sensitive paths.

**Q29.** What's the boolean parameter trap?
A. Multi-boolean parameter lists where call sites become unreadable rows of `true, false, true`.

**Q30.** When should a public method be hidden?
A. When same-class callers are the only callers.

---

## Code-smell mapping (Q31–Q40)

**Q31.** Which technique cures Long Parameter List?
A. Introduce Parameter Object, Preserve Whole Object, Replace Parameter with Method Call.

**Q32.** Which technique cures Comments?
A. Rename Method (the better name replaces the comment).

**Q33.** Which technique cures Inappropriate Intimacy?
A. Hide Method, Remove Setting Method.

**Q34.** Which technique cures Speculative Generality?
A. Remove Parameter (when the parameter was added "in case we need it").

**Q35.** Which technique cures Switch Statements?
A. Replace Constructor with Factory Method (when the switch is on type/kind).

**Q36.** Which technique cures Duplicate Code (when methods differ by a value)?
A. Parameterize Method.

**Q37.** Why is the boolean parameter trap a Switch Statement smell?
A. Because each boolean combination is effectively a `case` — an in-place type code.

**Q38.** Which technique helps with Data Clumps in parameter lists?
A. Introduce Parameter Object.

**Q39.** Why is Replace Constructor with Factory Method a creational pattern?
A. Because it shifts construction from a fixed `new` to a flexible static method that can return cached or polymorphic instances. (See Factory Method pattern.)

**Q40.** Which technique cures the Long Parameter List smell most generally?
A. Introduce Parameter Object — the workhorse cure.

---

## Architecture (Q41–Q50)

**Q41.** What's the semver impact of renaming a public method?
A. MAJOR — breaking change.

**Q42.** What's the safe way to rename a public API?
A. Add the new method; mark the old `@Deprecated`; migrate consumers; remove in next major version.

**Q43.** When should you migrate from exceptions to Result types?
A. When errors are normal (not exceptional), perf matters, or you want compile-time enforcement.

**Q44.** What's the functional options pattern in Go?
A. A factory takes variadic `Option` functions that mutate the constructed value, providing named-argument-like ergonomics.

**Q45.** Why does Java's `List.of(...)` use a factory method instead of a constructor?
A. To return cached / specialized implementations (`List.of()` → ImmutableCollections.ListN, of(1) → List12) and prevent extension.

**Q46.** What's wrong with `process(o, true, false, false)`?
A. Boolean parameter trap — call sites are unreadable.

**Q47.** What's the cost of stack trace capture in a thrown exception?
A. ~5-50 microseconds per throw, dominated by stack walking.

**Q48.** How to throw without stack trace?
A. Override `fillInStackTrace()` to return `this`, or pre-allocate a singleton exception. (Use sparingly — loses debuggability.)

**Q49.** What's the effect of Encapsulate Downcast post-JIT?
A. Often eliminated entirely; the JIT proves the cast is valid based on inlining.

**Q50.** Why does varargs cost an array allocation per call?
A. Java represents varargs as an array; each call allocates one. Hot loggers provide non-varargs overloads.

---

## Bonus (Q51–Q60)

**Q51.** What's the difference between a constructor and a factory method?
A. Constructor: always returns a fresh instance of exactly its declared type. Factory: can return cached, polymorphic, or null instances.

**Q52.** Is `Money.of(100, "USD")` a factory method?
A. Yes — by Java convention.

**Q53.** What's the most common factory method naming convention in modern Java?
A. `of(...)`, `from(...)`, `parse(...)`, `valueOf(...)`.

**Q54.** When does Lombok `@Builder` make Builder pattern free?
A. Most cases — generates the builder class at compile time.

**Q55.** Can you Replace Constructor with Factory Method and keep the constructor for serialization?
A. Yes — keep a private constructor for Jackson / serialization; expose factory methods for normal use.

**Q56.** What's `@VisibleForTesting`?
A. An annotation indicating the visibility was widened for tests but the method shouldn't be called by production code.

**Q57.** Why is "wide-to-narrow" parameter typing a refactoring direction?
A. Narrower types fail-fast at the boundary; wider types push failures into the body where they cause runtime ClassCastExceptions.

**Q58.** Why is Encapsulate Downcast preferable to a downcast at every caller?
A. One place to maintain; the IDE can replace the cast with generics in a single edit.

**Q59.** What's "permanent deprecation"?
A. An anti-pattern: methods marked `@Deprecated` since 2018 still in 2026 use. Either remove or remove the annotation.

**Q60.** What's the relation between Hide Method and the principle of least privilege?
A. Smaller API surface means fewer ways for callers to misuse — both a security and a maintainability principle.

---

## Next

- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- Recap: [junior.md](junior.md) → [middle.md](middle.md) → [senior.md](senior.md) → [professional.md](professional.md)
