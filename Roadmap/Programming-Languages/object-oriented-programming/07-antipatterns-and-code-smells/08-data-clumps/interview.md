# Data Clumps — Interview

> Twenty questions at the difficulty band you should expect for a senior Java role in 2026: not trivia, not puzzles, but applied design judgement around clumps, Value Objects, and modern Java records.

Each answer is short on purpose. If your real answer is twice as long, that is fine — interviewers welcome depth. If your answer is half as long and abstract, push harder.

---

### 1. Define a data clump in one sentence.

A tuple of three or more co-traveling, mostly-primitive types that appears in three or more method signatures or field groups within the same module, representing one missing concept in the domain model. The canonical reference is Fowler, *Refactoring* (2nd ed., 2018), chapter 3.

### 2. When does a data clump become a Value Object?

When the tuple has structural equality, immutability, invariants, behavior, and a single name in the ubiquitous language (Evans, *Domain-Driven Design*, 2003). Until then it is at best a parameter object.

### 3. Why three? Why not two?

Fowler's Rule of Three: the first time you do something, you just do it; the second, you wince; the third, you refactor. Two occurrences may be coincidence; three is a pattern that justifies the abstraction tax.

### 4. What does JEP 395 give a Value Object?

Final class, final fields, generated `equals`/`hashCode`/`toString`, canonical constructor, accessors, and a compact constructor for invariant enforcement. It turns ~40 lines of VO boilerplate into a one-line declaration.

### 5. Where do you enforce invariants in a record?

In the compact constructor. It runs before the implicit field assignments and is the canonical place for null checks, range checks, and normalization.

### 6. What's the BigDecimal-in-records gotcha?

`BigDecimal.equals` considers scale. `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` is `false`. A `Money` record using `BigDecimal` will inherit this. Mitigate by normalizing scale in the compact constructor (typically to the currency's default fraction digits).

### 7. Can a record be a JPA `@Entity`?

No. Entities require identity and mutability; records are value-typed and final. Records are an excellent fit for `@Embeddable`, however, and Hibernate 6.2+ supports record-backed embeddables directly.

### 8. Explain Escape Analysis in the context of VOs.

HotSpot's C2 compiler proves that a newly-allocated object cannot escape its compilation unit and then decomposes it into scalars (Scalar Replacement of Aggregates). For small, local, hot records the allocation effectively vanishes — the components live in registers or in the stack frame. EA fails on long-lived references and across virtual calls.

### 9. Are records always faster than equivalent classes?

No. Records compile to bytecode shape equivalent to a hand-rolled final class. The runtime cost is the same. Records are faster to *write* and review, not to execute.

### 10. How would you detect data clumps automatically?

Three layers: IntelliJ Structural Search templates (developer-time), an AST scan with Spoon or JavaParser (CI), and ArchUnit rules forbidding clumpy signatures in the domain package (build-fail). Heuristics like SonarQube's `S107` are necessary but insufficient.

### 11. Distinguish a data clump from primitive obsession.

A clump is a shape problem — multiple primitives travel together; the fix is one VO with multiple components. Primitive obsession is a type problem — a single primitive is overloaded to mean too many things; the fix is a tiny type with one component. They overlap and often coexist.

### 12. Distinguish a Value Object from an Entity.

Entities have identity that persists through state change (an `Order` with id 7 is the same order even after its contents change). VOs are defined by attributes; two `Money(100, USD)` instances are interchangeable. Identity vs interchangeability.

### 13. Why is mutability fatal to a Value Object?

A mutable VO can be aliased; mutation through one reference invisibly changes state observed through another. Equality stops being stable over time. The VO becomes an unmarked entity, except no one is treating it like one.

### 14. How does a parameter object differ from a Value Object?

A parameter object is a refactoring step that groups related arguments. It may or may not have invariants and behavior. A Value Object is the matured form: validated, immutable, behavior-bearing, named in the domain. Every VO can be a parameter object; not every parameter object is a VO.

### 15. What does ArchUnit add over PMD/Sonar for this topic?

Custom architectural rules with the full type information of the JVM. Where Sonar flags "too many parameters", ArchUnit flags "any method in this package accepts (BigDecimal, Currency) as separate params". Specific to your codebase, not generic.

### 16. Walk through extracting a VO from a 200-method codebase.

(1) Identify the clump with grep or Spoon. (2) Define the record with invariants. (3) Add a compatibility adapter — `static Money of(BigDecimal, Currency)` to ease the migration. (4) Refactor leaf methods first; the changes ripple up. (5) Add an ArchUnit rule once the last call site is gone. (6) Optionally remove the adapter once external callers are migrated.

### 17. When is a record the *wrong* choice for a VO?

When you need inheritance, when you must mutate internals for caching, when you need lazy initialization of components, or when the default `toString` would leak secrets and overriding it is more boilerplate than a plain class. Also: when targeting a Java version below 16.

### 18. How do you keep `equals`/`hashCode` consistent in a class-based VO?

Treat them as a single unit: override both, derive both from the same fields, never include mutable state. Use `Objects.equals` and `Objects.hash`. Cover with a test that asserts the contract — `a.equals(b)` implies `a.hashCode() == b.hashCode()`.

### 19. Your team resists VO extraction because "it's more code". What's your response?

Three points. (1) Records make the line count comparable to the original primitive group. (2) The "more code" is invariant-enforcement code that previously lived implicitly — and unreliably — in callers. (3) The class of bugs eliminated (currency mismatch, date range inversion, parallel-list drift) is among the most expensive to fix in production.

### 20. Sketch the `Money` VO you would commit on day one of a payments project.

A record with `BigDecimal amount` and `Currency currency`, a compact constructor that requires both non-null, normalizes scale to `currency.getDefaultFractionDigits()` with `RoundingMode.HALF_EVEN`, rejects negative amounts unless the project explicitly supports them, and provides `add`/`subtract`/`multiply(BigDecimal)`/`negate`. No `divide` without rounding mode. No public mutators. A factory `Money.zero(Currency)`. `toString` overridden to format with currency symbol. Persisted via `@Embeddable` or a JPA `AttributeConverter`.

---

## Memorize this

> A data clump is a missing type, not a long parameter list. The fix is a Value Object — preferably a `record` (JEP 395) — with immutability, value equality, self-validation, side-effect-free behavior, and a name from the ubiquitous language. Extract once you see the third repetition (Fowler), enforce with ArchUnit, persist with `@Embeddable`, and trust HotSpot's escape analysis to make the hot path effectively free.

---

## What's next

- `../07-primitive-obsession/interview.md` — companion question set on tiny types.
- `../../06-anemic-domain-model/interview.md` — questions on behavior placement once VOs exist.
- `./tasks.md` — practice the patterns these answers describe.
