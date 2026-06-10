# Record — Interview Q&A

50 questions on records, patterns, design, and runtime behavior.

---

## Section A — Basics (1-10)

**Q1. What is a Java record?**
A: A concise, immutable data carrier introduced in Java 14 (preview) and standardized in Java 16. Declared with the `record` keyword and a header listing components.

**Q2. What does the compiler auto-generate for a record?**
A: A canonical constructor, accessor methods (one per component), and `equals`/`hashCode`/`toString`. All can be overridden if needed.

**Q3. What's the accessor naming convention?**
A: Components are accessed via methods named after them: `point.x()`, not `point.getX()`.

**Q4. Are records mutable or immutable?**
A: Immutable. Component fields are `private final`. No setters.

**Q5. Can a record extend another class?**
A: No. Records implicitly extend `java.lang.Record` and are implicitly final.

**Q6. Can a record implement interfaces?**
A: Yes. Records can implement multiple interfaces.

**Q7. Can a record have additional instance fields?**
A: No. Only components become instance fields. Static fields are allowed.

**Q8. Can a record have static methods?**
A: Yes — static fields, methods, factory methods, etc., all allowed.

**Q9. What's a compact constructor?**
A: A constructor declared without parameter list, used for validation/normalization. The implicit field assignments happen after the body.

**Q10. Can records be generic?**
A: Yes. `record Pair<A, B>(A first, B second) { }`.

---

## Section B — Design (11-20)

**Q11. When should I use a record?**
A: When you need an immutable bundle of related values: DTOs, value objects, tuples, message classes, sealed-type variants.

**Q12. When should I NOT use a record?**
A: When the class needs mutable state, must extend another class, has substantial business logic, or is a service/controller.

**Q13. What's the difference between record and POJO with getters?**
A: Records are immutable (no setters), final, auto-generate equals/hashCode/toString, use field-name accessors. Less boilerplate.

**Q14. Can you replace all data classes with records?**
A: Most, but not all. JPA entities typically need no-arg constructors and setters; not all ORMs support records yet. DTOs work great as records.

**Q15. How do you handle "modify and return new" for records?**
A: Manual `withX(value)` methods that construct a new record with one field changed. JEP 468 may add built-in syntax.

**Q16. How do records relate to sealed interfaces?**
A: Sealed interface + records = algebraic data types. Each variant is a record carrying typed data; the sealed interface closes the hierarchy.

**Q17. What's a record pattern?**
A: Java 21+ feature for deconstruction: `if (obj instanceof Point(int x, int y))`. Binds the components to variables.

**Q18. Can records be used as map keys?**
A: Yes. Records have proper equals/hashCode based on components. Same-content records are equal.

**Q19. Should records have behavior or just data?**
A: Mostly data. Methods that operate on the components are fine (`Point.distance(Point)`, `Money.add(Money)`). Heavy business logic belongs elsewhere.

**Q20. Can records have nested types?**
A: Yes — nested records, classes, interfaces, enums. All work normally.

---

## Section C — Constructors & validation (21-30)

**Q21. What's the canonical constructor?**
A: The constructor whose parameters match the record components in order. Auto-generated unless explicitly declared.

**Q22. Can I have multiple constructors in a record?**
A: Yes — additional constructors must delegate to the canonical via `this(...)` as the first statement.

**Q23. Where do you put validation in a record?**
A: In the compact constructor. It runs before the implicit field assignment.

**Q24. Can I reassign fields in the compact constructor?**
A: You can mutate the *parameter variable* (`x = Math.abs(x)`), and the modified value gets assigned. You cannot use `this.x = ...` directly in compact form (that's the explicit canonical).

**Q25. What's the difference between compact and explicit canonical constructor?**
A: Compact has no parameter list and no explicit field assignments (assignment is implicit). Explicit canonical has both. Functionally equivalent.

**Q26. Can a record canonical constructor call `super(...)`?**
A: It implicitly calls `Record.<init>()`. You cannot explicitly call `super(...)` in records.

**Q27. Can a record canonical constructor throw checked exceptions?**
A: Yes, like any constructor.

**Q28. What if I forget defensive copying for a mutable list component?**
A: The record holds the caller's reference. Mutations to the original list affect the record. Add `values = List.copyOf(values)` in the compact constructor.

**Q29. Is a compact constructor's body run during deserialization?**
A: Yes. Java deserialization uses the canonical constructor, which runs the compact body. Validation re-runs.

**Q30. Can compact constructor have a `return` statement?**
A: No. The implicit field assignment must occur; an early return would skip it.

---

## Section D — Pattern matching (31-40)

**Q31. What are record patterns?**
A: Patterns that deconstruct records into their components. `obj instanceof Point(int x, int y)` binds `x` and `y`.

**Q32. Can you nest record patterns?**
A: Yes. `Pair(Point(int x, int y), int v)` binds `x`, `y`, `v` if the structure matches.

**Q33. How does pattern matching enforce exhaustiveness?**
A: For sealed types, the compiler checks every permitted variant has a case. For records implementing sealed interfaces, this works seamlessly.

**Q34. Can `var` be used in patterns?**
A: Yes. `case Point(var x, var y)` infers each component's type.

**Q35. What's a guarded pattern?**
A: A pattern with a `when` clause: `case Point(var x, var y) when x > 0`. The pattern matches only if both type-shape and condition hold.

**Q36. Can patterns appear in `switch`?**
A: Yes (Java 21+). `switch (obj) { case Point(int x, int y) -> ...; }`.

**Q37. Can patterns appear in `instanceof`?**
A: Yes. `if (obj instanceof Point(int x, int y))` — also Java 21+.

**Q38. What if the receiver is null in a pattern switch?**
A: Without an explicit `case null`, it throws `NullPointerException`. With `case null`, it's matched.

**Q39. Are patterns checked at compile or runtime?**
A: Both. The compiler checks structural fit and exhaustiveness; the JVM checks values at runtime.

**Q40. What's the bytecode for record patterns?**
A: `invokedynamic` to `SwitchBootstraps.typeSwitch` for type matching, plus accessor calls (`record.x()`, `record.y()`) to extract components.

---

## Section E — Edge cases & advanced (41-55)

**Q41. Can records have annotations on components?**
A: Yes. They apply to the record component itself and the corresponding field/parameter/accessor (depending on the annotation's `@Target`).

**Q42. What's `Class.isRecord()`?**
A: Returns true if the class has a `Record` attribute (i.e., declared as a record).

**Q43. What's `Class.getRecordComponents()`?**
A: Returns an array of `RecordComponent` describing each component: name, type, accessor, annotations.

**Q44. Can I serialize a record with Java serialization?**
A: Yes. The default behavior writes components and reconstructs via canonical constructor. Validation re-runs.

**Q45. Can Jackson serialize records?**
A: Yes since Jackson 2.12. Default uses component names; `@JsonProperty` works on components.

**Q46. Can Hibernate use records as entities?**
A: Limited. Records work as `@Embeddable` since Hibernate 6. Full entity support is awkward (records have no setters; some Hibernate features assume them).

**Q47. Can a record be `Cloneable`?**
A: Technically yes, but pointless — records are immutable, so cloning makes no sense. Just share the reference.

**Q48. What's the cost of a record allocation vs an int field?**
A: A record has object header overhead (~16 bytes). For pure number-crunching, primitives are cheaper. But escape analysis often eliminates short-lived records.

**Q49. Can records be hidden classes?**
A: Yes. `Lookup.defineHiddenClass` works for records. Used in some advanced framework code.

**Q50. Why is `Record` abstract?**
A: To force every concrete record class to provide proper `equals`/`hashCode`/`toString`. The abstract methods can be auto-generated by the compiler or written explicitly.

---

## Bonus — staff (51-55)

**Q51. How would you migrate a 30-field POJO to a record?**
A: Step 1: identify which fields are truly canonical state. Step 2: split into smaller records if the data is too wide. Step 3: convert. Step 4: update callers (getters → accessors). Step 5: replace setters with `withX` or builder patterns.

**Q52. Is there a way to copy a record with one field changed without writing `withX` methods?**
A: Until JEP 468 (or successor) standardizes `with` syntax, no. You must write `withX` methods or use a builder.

**Q53. What's the future of records?**
A: Built-in `with` syntax, deeper pattern matching (nested + guards combined), value classes (Project Valhalla) make records flat in memory.

**Q54. How does Project Valhalla affect records?**
A: Value classes will be similar to records but without identity. Records can be considered "objects with identity"; value classes are "data without identity, flat in memory."

**Q55. When wouldn't you use a sealed interface + records pattern?**
A: When variants are open-ended (plugins). When variants don't carry data (use enums). When the variants are all just labels (enum is more compact).

---

**Use this list:** mix one Q from each section. Strong candidates demonstrate they understand records as a *design tool*, not just a syntactic shortcut.
