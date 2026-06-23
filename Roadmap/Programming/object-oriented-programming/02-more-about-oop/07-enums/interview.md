# Enums — Interview Q&A

50 questions on enum fundamentals, design patterns, and runtime behavior.

---

## Section A — Basics (1-10)

**Q1. What is an enum?**
A: A type with a fixed set of named singleton instances declared at compile time.

**Q2. When were enums introduced in Java?**
A: Java 5 (2004).

**Q3. Can enums have constructors?**
A: Yes, but always private. Each enum constant invokes the constructor implicitly.

**Q4. Can enums have methods?**
A: Yes — instance methods, static methods, and per-constant overrides.

**Q5. Can enums implement interfaces?**
A: Yes. Common pattern for strategy enums.

**Q6. Can an enum extend a class?**
A: No. All enums extend `java.lang.Enum<E>` implicitly.

**Q7. Can you extend an enum?**
A: Not from outside. Enums are implicitly final (with the exception of per-constant anonymous subclasses).

**Q8. What does `values()` return?**
A: An array of all enum constants in declaration order (a fresh clone each call).

**Q9. What does `valueOf(String)` do?**
A: Returns the constant whose `name()` matches the input. Throws `IllegalArgumentException` if not found.

**Q10. What's `ordinal()`?**
A: The zero-based position of the constant in declaration order. Don't use for persistence.

---

## Section B — Design (11-20)

**Q11. When should you use an enum?**
A: When the value must be one of a small, fixed, known set — like days, statuses, HTTP methods, configuration tiers.

**Q12. When should you NOT use an enum?**
A: When the set of values isn't truly fixed — e.g., user roles that admins can add. Or when each variant has substantial unique data — sealed records may be better.

**Q13. What's the strategy enum pattern?**
A: Each constant has its own implementation of an abstract method. Lets you treat enum constants as strategies.

**Q14. Why prefer enum over `int` constants?**
A: Type safety, iterable, named in logs/serialization, no magic numbers, no chance of out-of-range values.

**Q15. Why prefer enum-based singleton over double-checked locking?**
A: Thread-safe by class init contract, serialization-safe, reflection-resistant. Effective Java Item 3.

**Q16. What's an enum + interface combo for?**
A: Allow a fixed set of well-known options plus a way for users to add custom ones via the interface. The enum constants implement the interface; user code can supply additional impls.

**Q17. Is `==` safe for enum comparison?**
A: Yes — all enum constants are unique singletons. `==` is preferred over `equals` (also handles null).

**Q18. What's the cost of an enum constant?**
A: Same as any object — one allocation per constant, done at class init. Methods use vtable like any class.

**Q19. Should enums have heavy logic in constructors?**
A: No. Enum constructors run during class init (`<clinit>`); failures throw `ExceptionInInitializerError` for all subsequent uses.

**Q20. What's wrong with `enum.ordinal()` in storage?**
A: Reordering or inserting constants changes ordinals; old persisted data references wrong constants. Use `name()` instead.

---

## Section C — EnumSet / EnumMap (21-30)

**Q21. Why is EnumSet faster than HashSet for enum keys?**
A: Uses bitset internally (long for ≤64 constants, long[] otherwise). `contains`/`add` are bitwise operations.

**Q22. Why is EnumMap faster than HashMap?**
A: Array-indexed by ordinal — O(1) without hashing or collisions. Iteration is linear scan.

**Q23. What's the iteration order of EnumSet/EnumMap?**
A: Declaration order of the enum constants.

**Q24. Can EnumSet contain duplicates?**
A: No, it's a Set. Each constant is present at most once.

**Q25. Can EnumMap have null keys?**
A: No, but null values are allowed.

**Q26. How is `EnumSet.allOf(X.class)` implemented?**
A: Returns a set with all constants. Internally sets all bits in the bitset.

**Q27. What's `EnumSet.complementOf(other)`?**
A: Returns a set containing all constants NOT in `other`. Bitwise NOT.

**Q28. Is EnumSet thread-safe?**
A: No. Wrap in `Collections.synchronizedSet` or use a copy-on-write alternative.

**Q29. When would you use HashMap over EnumMap?**
A: Almost never for enum keys. Maybe if the API only accepts Map and you have one specific need. EnumMap is faster, smaller memory.

**Q30. Can EnumSet be used in a switch?**
A: Indirectly. You'd check `set.contains(constant)`, not switch on the set itself.

---

## Section D — Modern features (31-40)

**Q31. How do enums interact with sealed types?**
A: They're complementary. Enum for label sets; sealed types for variant types with payloads.

**Q32. What's pattern matching on enums?**
A: `switch` over an enum where the compiler verifies exhaustiveness. Java 21+ adds binding and guards.

**Q33. Can a record implement a sealed interface that an enum also implements?**
A: Yes. Both are valid implementations. Use sealed interface to abstract over them.

**Q34. What happens if I add a new enum constant without updating switches?**
A: Without exhaustive switch (i.e., with `default`), the new constant goes through default. With exhaustive switch (no default), the compiler errors. Pattern matching switch enforces this.

**Q35. How do enums work with serialization?**
A: Default Java serialization writes `name()`, reads back via `Enum.valueOf`. Returns the same singleton.

**Q36. How do enums work with JSON (Jackson)?**
A: By default, serialized as the constant's name. Customizable with `@JsonValue` / `@JsonProperty` for non-name representations.

**Q37. Can enum constants have type parameters?**
A: No. Enum constants don't carry type variables. (Use sealed records for typed variants.)

**Q38. Can enum extend a generic Enum<E>?**
A: It already does — implicitly extends `Enum<E>` where `E` is the enum's own type.

**Q39. Can enum implement Comparable<E>?**
A: Already does. `Enum<E> implements Comparable<E>`. Compares by ordinal.

**Q40. What's the recommended enum pattern for state machines?**
A: Each constant represents a state. Per-constant `transition(Event)` method returns the next state. Compile-time exhaustiveness ensures all transitions are defined.

---

## Section E — Edge cases & advanced (41-50)

**Q41. Can you serialize an enum that has transient fields?**
A: Yes; default serialization only writes `name()`. The transient fields are reconstructed via the singleton lookup.

**Q42. Can enum constants override `toString`?**
A: Yes. `toString` is not final on Enum (unlike `equals`/`hashCode`). Useful for custom display.

**Q43. What happens if `valueOf` is called with an unknown name?**
A: Throws `IllegalArgumentException`. Prefer try-catch or a custom safe lookup with `Optional`.

**Q44. Can enum implement multiple interfaces?**
A: Yes. Like any class.

**Q45. What's the cost of `EnumSet.of(...)` vs `Set.of(...)`?**
A: `EnumSet.of` is faster, smaller, type-restricted to the enum. `Set.of` is generic but less optimized for enum keys.

**Q46. Can enum constants be null?**
A: A *reference* of enum type can be null, but the constants themselves are never null. `valueOf("not_a_constant")` throws.

**Q47. Why does `Enum.equals` final?**
A: To preserve the contract: enum constants are equal iff they're the same instance. Overriding could break this.

**Q48. Can you have a parameterized enum?**
A: Not directly. The enum class itself isn't generic. But constants can have generic methods, and the enum can implement generic interfaces.

**Q49. What's the maximum size of an enum?**
A: No JLS limit; class file format limit is 65535 fields. Practical limit ~thousands. Above 64, `JumboEnumSet` activates.

**Q50. What's the difference between `enum` and `record` in modern Java?**
A: Enum: closed set of singleton instances. Record: data carrier (any number of instances). They serve different purposes; sometimes complementary (sealed interface with enum variants and record variants).

---

## Bonus — staff (51-55)

**Q51. How would you implement a finite state machine with enums?**
A: Each constant is a state. Define `next(Event)` per-constant. Each returns the next state. Exhaustive switches over events ensure no transitions are missed.

**Q52. Should enum constants do I/O in their constructor?**
A: No — they run at class init. I/O failures break the entire class. Use lazy init via static methods or holder pattern.

**Q53. How does Spring handle enums in @Value?**
A: Reads the property and matches by `name()`. Custom converters can map other formats.

**Q54. What's a smart way to add data to an existing enum?**
A: Add fields to the enum class and pass them in the constructor for each constant. Existing callers using `name()` etc. are unaffected.

**Q55. When would you migrate from enum to sealed records?**
A: When variants need typed payloads, generic parameters, or substantially different shapes. Sealed records preserve exhaustiveness while adding flexibility.

---

**Use this list:** answer aloud. Strong candidates explain *why* enums are designed this way (singleton, type-safe, serializable).
