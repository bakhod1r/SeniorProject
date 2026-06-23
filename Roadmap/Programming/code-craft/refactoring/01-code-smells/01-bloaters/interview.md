# Bloaters — Interview Q&A

> 50+ questions across all skill levels (junior → professional). Use as a self-review or interview prep.

---

## Junior level (15 questions)

### Q1. What is a code smell?
A surface indication of a deeper design problem. Not a bug — your program runs fine. A smell is a *warning* that the code may be hard to understand, change, or test. Coined by Kent Beck; popularized by Martin Fowler in *Refactoring* (1999).

### Q2. Name the five Bloaters.
Long Method, Large Class, Primitive Obsession, Long Parameter List, Data Clumps.

### Q3. What's the rule of thumb for "method too long"?
Classic: doesn't fit on one screen (~20–30 lines). Better: cognitive — does the method have multiple unrelated phases? If you can write a one-line comment for each phase, those phases want to be methods.

### Q4. Give a classic Long Method cure.
Extract Method. Take a coherent fragment, give it a name, replace with a call. Often combined with Replace Temp with Query (turn a temp variable into a method) and Decompose Conditional (extract complex `if`/`else` branches).

### Q5. What is Primitive Obsession?
Using a primitive type (`String`, `int`, `double`) where a small dedicated class would be more honest. Example: `String email` (any string passes; no validation; no behavior). Cure: Replace Data Value with Object — create an `Email` value type.

### Q6. What's wrong with `String userId`?
- No validation: `""` and `"not-a-uuid"` are valid types.
- No type safety: `transferMoney(String from, String to)` lets you swap the args at compile time.
- No behavior: helpers (`UserIdHelper.normalize(...)`) live elsewhere, not on the value.

Cure: a typed `UserId` class.

### Q7. When is a parameter list too long?
Classic threshold: more than 3 or 4. Better signals: parameters that always travel together (Data Clump), boolean flags toggling behavior, or many `null`-defaulted optional parameters.

### Q8. Cure for Long Parameter List?
Introduce Parameter Object: group the parameters into an object. Or Preserve Whole Object: pass the existing object instead of unwrapped fields. Or Replace Parameter with Method Call: let the callee compute it.

### Q9. What's a Data Clump?
A group of fields that always appear together — in many class field lists, many parameter lists. Examples: `(street, city, state, zip)`, `(lat, lon)`, `(currency, amount)`. The fact they always travel together means they form a missing concept.

### Q10. How are Primitive Obsession and Data Clumps related?
Both signal a missing type. Primitive Obsession: one primitive doing a typed job. Data Clumps: several primitives doing one collective typed job. Both are cured by introducing a named class.

### Q11. Why is Large Class bad?
- Hard to read: a new reader has to learn the whole class.
- Hard to change: bug fixes risk breaking unrelated functionality.
- Hard to test: instantiating it requires many collaborators.
- Violates SRP: the class is changed for many reasons.

### Q12. What's the SRP?
**Single Responsibility Principle**: a class should have one reason to change. If a class is changed because of marketing logic *and* billing logic *and* shipping logic, it has at least three responsibilities — extract them.

### Q13. Cure for Large Class?
Extract Class: move a cluster of related fields and methods into a new class. The original class becomes a coordinator. Optionally, Extract Subclass (when the cluster represents a variant) or Extract Interface (when it represents a role).

### Q14. Refused Bequest — wait, that's not in Bloaters?
Correct. Refused Bequest is in [OO Abusers](../02-oo-abusers/junior.md). It's about subclasses that don't use what they inherit. Don't confuse it with Bloaters.

### Q15. A method has 100 lines but does one well-named operation in a single loop. Bloater?
No. The smell is about *cognitive overload from unrelated phases*, not line count. A focused, single-purpose method is fine even if long.

---

## Middle level (15 questions)

### Q16. Why does extracting a method *not* fix anything if the method names are bad?
Bad names hide intent worse than long methods. `processStep1()`, `helper()`, `doStuff()` extracted from a 200-line method create a worse experience: the reader still has to read 5 helpers, and the helpers don't tell them anything. Often the right move is to refactor the data first (introduce types) — better names emerge naturally.

### Q17. Compare cyclomatic complexity vs cognitive complexity.
Cyclomatic counts decision points (`if`, `&&`, `case`) — blind to nesting. Cognitive penalizes nesting (Sonar's invention). Cognitive correlates with what humans actually find hard to read. Use cognitive for maintainability gates; use cyclomatic for test-coverage planning.

### Q18. What's the Strangler Fig pattern?
Wrap the bloater in a new interface. Route new use cases to a new implementation. Migrate old callers gradually. The bloater stays operational throughout; eventually it's unreachable and can be deleted. Coined by Martin Fowler.

### Q19. When is a 14-parameter method NOT a smell?
Almost never. Sometimes a method is the surface of a generated API (e.g., from a DSL); leave alone if it's regenerated. Otherwise, refactor.

### Q20. Boolean parameter trap — define it.
Boolean parameter trap: a `boolean` argument that toggles method behavior, making the call site `f(true, false, true)` opaque. The reader can't tell what each flag means without checking the signature. Cure: Replace Parameter with Explicit Methods (separate `f()` and `fAlt()`) when the booleans switch behavior; or move the booleans into a named options object when they're configuration.

### Q21. A team uses `varargs` (`String... names`) to "avoid Long Parameter List." Critique.
Disguises the smell, doesn't cure it. Varargs is appropriate for genuinely homogeneous parameters (`Math.max(int...)`). Misused for heterogeneous parameters, it removes type checking and makes the call site unreadable. Use parameter objects instead.

### Q22. What's the trade-off of replacing `String customerId` with a `CustomerId` value object?
Pros: type safety, validation in one place, a home for behavior. Cons: extra allocation per construction (mostly mitigated by JIT escape analysis in Java/Go; real cost in Python). Almost always worth it for non-trivial types.

### Q23. Why is `double` wrong for money?
Floating-point arithmetic isn't decimal-exact: `0.1 + 0.2 != 0.3`. Errors accumulate across additions; totals diverge from the per-line sum. Use `BigDecimal` (Java), `Decimal` (Python), or fixed-point integer (cents as `long`/`int64` in Go).

### Q24. Money should NOT be `double`. What about latency in milliseconds?
`long` (or `int64`) is fine for time durations. Latency doesn't have decimal-exactness requirements; rounding-to-millis is acceptable. `Duration` value types (`time.Duration` in Go, `java.time.Duration` in Java) prevent unit confusion (was that ms or μs?).

### Q25. Hot loop: `Coord{Lat, Lon}` constructed per iteration. Performance issue?
Depends on the language. Java: usually scalar-replaced by escape analysis — zero cost. Go: zero cost (struct values don't allocate when they don't escape). Python: real cost (~50 bytes/instance). Verify with a profiler before optimizing.

### Q26. A 5,000-line class with 60 fields. Refactor or rewrite?
Almost always refactor. Strangler fig: introduce smaller classes alongside; migrate callers gradually. Rewrites famously fail more often than refactors — they re-introduce known bugs and lose institutional knowledge.

### Q27. How do Bloaters appear at the architectural level?
Long Method → Long Microservice. Large Class → Monolithic Service ("macroservice"). Primitive Obsession → `String userId` flowing across service boundaries with no schema. Long Parameter List → 14-query-param endpoints. Data Clumps → repeated address fields across 12 endpoints.

### Q28. What's an "anti-corruption layer"?
A boundary between two domain models that translates one to the other. Used during gradual rewrites: the new service has its own clean model; the anti-corruption layer maps to/from the legacy model so the new service isn't polluted.

### Q29. Cure for `(latitude, longitude)` clump in a strongly-typed language?
A `Coordinate` value object. In Go: `type Coordinate struct{ Lat, Lon float64 }`. In Java: `record Coordinate(double lat, double lon)`. In Python: `@dataclass(frozen=True) class Coordinate: lat: float; lon: float`. Helpers like `DistanceTo` belong on the type.

### Q30. When NOT to extract a class from a Large Class?
When the extracted class would have poor cohesion (e.g., extracting `CustomerHelper` because "it has helper-ish methods"). The extracted class should own a coherent concept with both data and behavior. If you're moving only methods, you're really doing Move Method, and the original class wasn't really "Large" in the relevant sense.

---

## Senior level (10 questions)

### Q31. ArchUnit fitness function — give an example for catching Large Class.
```java
@ArchTest
static final ArchRule services_must_not_have_too_many_methods =
    classes().that().resideInAPackage("..service..")
             .should().haveLessThanOrEqualTo(15)
             .methodsThatAreNotPrivate();
```
Run as a JUnit test. Fails the build if any service exceeds 15 public methods.

### Q32. SonarQube baseline mode — what is it and when do you use it?
A mechanism that captures current violations as a baseline; future builds fail only on **new** violations and changes to existing violation lines. Used when introducing a linter to a legacy codebase — avoids the "Day 1: 8,000 violations" problem.

### Q33. How does the Mikado Method help refactor a tangled bloater?
Attempt the desired refactoring; record everything that breaks; revert. The broken things become prerequisite refactorings. Apply them; re-attempt. Recurse. Result: a *dependency tree* of small refactorings, executed bottom-up. The big refactor never happens as a single risky step.

### Q34. Strangler fig vs Branch by Abstraction?
Strangler fig: gradual replacement at the *use site* level — new functionality routes to new code; old paths keep working. Time scale: months to years. Branch by Abstraction: introduce an interface; provide two implementations side-by-side; switch via feature flag. Time scale: days to weeks. Strangler fig for big architectural moves; Branch by Abstraction for tactical refactors with rollback safety.

### Q35. What's a "characterization test"?
A test that captures the *current* behavior of code (not the desired behavior). Used before refactoring code without specs: run the code on representative inputs in production; record inputs and outputs; replay as tests. Once refactoring is complete, replace these with intent-based tests.

### Q36. How do you decide between Extract Method and Replace Method with Method Object?
Extract Method when each fragment is simple and doesn't share much state. Replace Method with Method Object when many local variables are interrelated and would have to be passed everywhere — turning the whole method into a class lets the variables become fields.

### Q37. What's a "code hotspot"?
A file or class that is both **large** and **frequently changed**. The metric: lines × commits. The top 5% of hotspots usually contain disproportionate bug density. Refactor those first; ignore the 5,000-line class that hasn't changed in three years.

### Q38. Domain-Driven Design — how does it relate to Bloaters?
DDD's "bounded context" maps to Extract Class at architectural scale: identify a cohesive subdomain; give it its own model and boundary. A god class (Large Class smell) usually spans multiple bounded contexts — DDD analysis (event storming, use case mapping) reveals where to split.

### Q39. Anemic Domain Model — what is it, and which Bloater(s) does it embody?
An "anemic" model has data without behavior — getters/setters and nothing else. Embodies Data Class (Dispensables) and indirectly Primitive Obsession + Data Clumps (the data isn't even typed properly). Cure: move behavior onto the data classes (Move Method); introduce value objects.

### Q40. Why do rewrites famously fail?
Joel Spolsky's 2000 essay: a rewrite re-introduces every bug the original learned to handle, plus new ones. The original code's complexity isn't accidental — it embodies hard-won knowledge of edge cases, customer requests, regulatory rules. A rewrite without that knowledge re-discovers it the hard way. Strangler fig avoids this trap.

---

## Professional level (10 questions)

### Q41. What is HotSpot escape analysis, and how does it affect value-object refactoring?
EA detects objects whose lifetime is bounded to a single method. EA can **stack-allocate** (no GC pressure) or **scalar-replace** (eliminate the object entirely; use the fields as locals). Result: many value-object refactors pay zero runtime cost in hot paths. Verify with `-XX:+PrintEscapeAnalysis`.

### Q42. When does HotSpot fail to inline an extracted method?
- Bytecode > `MaxInlineSize` (35 bytes default) and the method is "cold" (not yet hot).
- The call site is **megamorphic** (4+ concrete types).
- Total inline depth would exceed `MaxInlineLevel`.

Detect with `-XX:+PrintInlining`.

### Q43. Project Valhalla — what does it change?
Java's "primitive classes" (a.k.a. value classes) are flat values: no header, no identity, laid out inline in arrays. Cures Primitive Obsession with truly zero overhead — even when escape analysis fails. Targeted preview in Java 22+.

### Q44. Kotlin's `value class` — how does it compile?
At the JVM level, the wrapper is **erased**. `value class Email(val value: String)` becomes `String` in bytecode. `fun process(e: Email)` compiles to `process(String)`. The wrapper exists only at compile time for type checking. Zero runtime cost. Caveat: nullable, generic, and interface contexts force boxing.

### Q45. Why is `List<Integer>` slower than `int[]` in Java?
`Integer` boxes — each element is a heap-allocated object with a header. `List<Integer>` has 3 levels of indirection: list → array → Integer object → int. Cache-locality is poor. `int[]` is flat — 4 bytes per element, no headers, contiguous. For hot loops on primitives, prefer `int[]`.

### Q46. False sharing — how does Large Class amplify it?
Two threads modifying different fields of the same class concurrently can hit the same cache line; every write invalidates the other thread's view. Large classes pack more fields together → more chances for false sharing. Cures: `@Contended` annotation, manual padding, or Extract Class so contended fields live in separate objects.

### Q47. Go's escape analysis — how do you verify a value object stays on stack?
`go build -gcflags='-m=2' ./... 2>&1`. Look for `does not escape` (good) or `escapes to heap` (bad). For a value object meant to stay on stack: don't store it in a field, don't return a pointer to it, don't pass it to interface methods (interfaces always cause escape).

### Q48. Why is `String.matches(regex)` slower than a precompiled `Pattern`?
`String.matches` *compiles the regex on every call*. A precompiled `Pattern` (`Pattern.compile`) does the work once. Typical 4–10× speedup for high-frequency callers. Always precompile regexes used in value-object validation.

### Q49. CPython's `@dataclass(slots=True)` — what does it change at the bytecode level?
Without `slots`: each instance has a `__dict__` (a hash table) for arbitrary attribute storage. With `slots=True`: the class declares fixed slots; instances store fields in fixed offsets like a C struct. Result: ~50% memory reduction per instance and faster attribute access (no dict lookup).

### Q50. JIT devirtualization — how does Replace Conditional with Polymorphism interact with it?
Polymorphism replaces a `switch` with virtual dispatch. The JIT can devirtualize **monomorphic** call sites (one concrete type seen) and **bimorphic** sites (two types) — turning them back into direct calls. **Megamorphic** sites (4+ types) defeat devirtualization, paying full v-table cost. Result: polymorphism is roughly free for ≤2 types; gets expensive for many types — at which point a switch on type code or a hash map dispatch may be faster.

---

## Bonus: cross-language scenario questions (5)

### Q51. Implement an `Email` value type in Java, Python, Go, and Kotlin. Briefly compare runtime cost.

| Language | Implementation | Runtime cost |
|---|---|---|
| Java 17 | `record Email(String value)` with constructor validation | ~0 in hot paths (EA scalar-replaces) |
| Java 22 (Valhalla) | `primitive class Email { String value; }` | 0 (true value type) |
| Kotlin | `@JvmInline value class Email(val value: String)` | 0 (compile-time erased) |
| Go | `type Email string` + constructor function | 0 (named type) |
| Python | `@dataclass(frozen=True, slots=True) class Email` | ~30 bytes/instance, attribute lookup |

### Q52. A team has Long Parameter List in Go. They convert to functional options. Trade-offs?

Pros: extensible (add new options without breaking callers); call site self-documenting (`WithRetries(3)`); defaults centralized.

Cons: more boilerplate (one factory per option); mandatory parameters can hide if not enforced (e.g., `NewServer("", 0)` should be a compile error but isn't); slightly slower than struct-arg version due to per-option closure.

Use functional options for highly configurable APIs (`http.Server`); use a config struct for everything else.

### Q53. Python's duck typing — does it make Primitive Obsession worse or better?

Worse, in the default. Without explicit types, `def f(x):` accepts anything; the smell hides longer. With `mypy --strict`, distinct types catch the same bugs Java does. Without static checking, runtime errors surface only when the smell finally bites. Adopt mypy/pyright early; reach for `NewType` for ID types.

### Q54. Functional languages claim Bloaters don't apply. True or false?

False, with caveats. Long Method appears as Long Function or Long `let`/`where` chain. Large Class doesn't apply (no classes), but Large Module does. Primitive Obsession is *less* common (FP cultures push toward `newtype` early). Long Parameter List is common but cured by currying or record types. Data Clumps appear as repeated tuples — cure is named record types. The smells migrate, the cures migrate, but the substance is the same.

### Q55. You inherit a service with all five Bloaters in the same module. Where do you start?

Order of attack:

1. **Tests first.** If coverage is poor, write characterization tests for the changed code paths.
2. **Primitive Obsession** — introduce value objects at the system boundary. This cures Data Clumps (the missing concepts find homes) and shrinks Long Parameter List (objects replace many primitives).
3. **Long Method** — Extract Method now that better names are available.
4. **Large Class** — Extract Class along the seams revealed by steps 2–3.
5. **Repeat** until each remaining bloater is small or gone.

Don't try to fix all five at once on one PR — that's a rewrite by another name. Each step should be a small, individually-testable refactor.

---

## Cheat sheet

| Smell | Telltale sign | Primary cure |
|---|---|---|
| **Long Method** | Method spans multiple "phases" | [Extract Method](../../02-refactoring-techniques/01-composing-methods/junior.md) |
| **Large Class** | 15+ fields or 30+ methods, mixed responsibilities | [Extract Class](../../02-refactoring-techniques/02-moving-features/junior.md) |
| **Primitive Obsession** | `String email`, `int dollars`, type code constants | [Replace Data Value with Object](../../02-refactoring-techniques/03-organizing-data/junior.md) |
| **Long Parameter List** | 5+ parameters, boolean trap, `null`-defaulted optionals | [Introduce Parameter Object](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md) |
| **Data Clumps** | Same fields recur together everywhere | [Extract Class](../../02-refactoring-techniques/02-moving-features/junior.md) |

> **Order of attack** for systems with all five: value types → parameter objects → Extract Method → Extract Class.
