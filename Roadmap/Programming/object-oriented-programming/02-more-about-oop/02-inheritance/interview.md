# Inheritance — Interview Q&A

50 questions ranging from junior to staff/architect level.

---

## Section A — Basics (1-10)

**Q1. What is inheritance?**
A: A mechanism by which a class (subclass) acquires the fields and methods of another class (superclass), expressing an "is-a" relationship.

**Q2. What's the keyword for inheritance in Java?**
A: `extends` for class-to-class inheritance, `implements` for interface implementation. A class can `extends` one class and `implements` many interfaces.

**Q3. Does Java support multiple class inheritance?**
A: No. A class can extend only one other class. It can implement multiple interfaces, including those with default methods, which provides a controlled form of multiple inheritance.

**Q4. What is the root class of all Java classes?**
A: `java.lang.Object`. Every class transitively extends Object, providing methods like `equals`, `hashCode`, `toString`, `getClass`.

**Q5. Are constructors inherited?**
A: No. Each class declares its own constructors. A subclass constructor calls the parent's via `super(...)` (implicitly or explicitly).

**Q6. What does `super()` do?**
A: Invokes the superclass's constructor. Must be the first statement (until Java 22 preview) of the subclass's constructor; otherwise the compiler inserts an implicit `super()`.

**Q7. What happens if the parent has no no-arg constructor?**
A: The subclass cannot rely on implicit `super()`; it must explicitly call one of the parent's defined constructors with `super(args)`.

**Q8. Are private members inherited?**
A: They exist in the parent's portion of the object's memory but are not visible by name in the subclass. Effectively "not inherited" in the access sense.

**Q9. What's the difference between override and overload?**
A: Overload: same method name, different parameter list, in the same class (or visible). Override: same method name and parameters in a subclass, replacing the parent's implementation. Overrides are resolved at runtime; overloads at compile time.

**Q10. What is the `@Override` annotation for?**
A: It tells the compiler "this method overrides a parent method." If the signature doesn't actually match a parent, it's a compile error. Always use it for overrides.

---

## Section B — Polymorphism & dispatch (11-20)

**Q11. What is dynamic dispatch?**
A: Runtime selection of which method to call based on the actual class of the receiver, even though the variable's declared type may be a superclass or interface.

**Q12. Is this dispatch polymorphism applied to fields?**
A: No. Field access is statically dispatched based on declared type. Two classes with same-named fields don't override; they hide.

**Q13. Are static methods polymorphic?**
A: No. Static methods are looked up based on the declared type of the call expression, not the runtime type. They can be hidden, not overridden.

**Q14. Why doesn't `((A) b).staticMethod()` call B's version when b is actually B?**
A: Because static methods are bound at compile time. The cast doesn't change which class is searched. Cleaner to call `A.staticMethod()` directly.

**Q15. What is the cost of a virtual method call vs a non-virtual one?**
A: A virtual call is one indirect load + one indirect call (~5 ns cold, ~1 ns hot). The JIT often devirtualizes monomorphic calls, reducing them to direct calls.

**Q16. What is "monomorphic" vs "megamorphic" dispatch?**
A: Monomorphic: only one receiver class observed at this call site → JIT inlines. Bimorphic: two → branch. Megamorphic: 3+ → vtable lookup, no inlining.

**Q17. What is CHA?**
A: Class Hierarchy Analysis. The JIT inspects loaded classes to determine if a virtual call can be resolved as direct (no overrides exist). It can deoptimize if a new subclass is loaded later.

**Q18. What's the difference between `invokevirtual` and `invokeinterface`?**
A: `invokevirtual` uses a vtable index resolved at link time. `invokeinterface` uses an itable lookup since interfaces can be implemented by classes in arbitrary positions in their hierarchy. `invokevirtual` is slightly faster, but the JIT optimizes both heavily.

**Q19. What does `super.m()` compile to?**
A: `invokespecial` — a direct call to the parent's `m`, no vtable lookup. This is why `super.m()` always calls the immediate parent's version, never an override.

**Q20. Can a `private` method be overridden?**
A: No. Private methods are not visible to subclasses, so subclass methods with the same name and signature are entirely separate methods (not overrides).

---

## Section C — LSP and design (21-30)

**Q21. What is the Liskov Substitution Principle?**
A: A subtype must be substitutable for its base type without altering the program's correctness. Subclasses must honor the parent's pre/post-conditions and invariants.

**Q22. Why is `Square extends Rectangle` a classic LSP violation?**
A: Setting `square.width = 5` violates the rectangle invariant that width and height are independent. Code that works with rectangles breaks when handed a square.

**Q23. How do you decide between inheritance and composition?**
A: Use inheritance only for "is-a" relationships where substitutability holds. Use composition when you want code reuse without coupling. Default: composition.

**Q24. What's the fragile base class problem?**
A: A change to a parent class can silently break subclasses that depend on its implementation details (e.g., which methods call which). Mitigation: make the class final, document self-use contracts, or design only for explicit extension points.

**Q25. What is the Open/Closed Principle?**
A: "Open for extension, closed for modification." Practically: design seams (interfaces, hooks) where extension is expected; keep the rest stable.

**Q26. When should a class be `final`?**
A: When you don't intend it to be subclassed and want the compiler to enforce that. Default for value-like types (`String`, `Money`, records).

**Q27. What's the alternative to deep hierarchies?**
A: Composition + interfaces. Decompose responsibilities into roles (interfaces) and compose objects from collaborators rather than extend.

**Q28. What is the diamond problem?**
A: When a class inherits from two parents that both override a method, ambiguity arises about which override applies. Java avoids it for class inheritance (single class) but solves it for default methods via explicit override-and-disambiguate.

**Q29. Why are interfaces preferred over abstract classes for new APIs in modern Java?**
A: Interfaces support multiple inheritance, default methods, sealed hierarchies, no constructor coupling, and decouple types from implementation. Abstract classes still useful for shared state and templates.

**Q30. What is "Tell, Don't Ask"?**
A: A design guideline: tell objects what to do, don't pull data out and decide externally. Inheritance can violate this if subclasses expose internal state via accessors. Encapsulation + behavior on the parent is preferred.

---

## Section D — Sealed types & pattern matching (31-40)

**Q31. What are sealed classes?**
A: Java 17 feature: a class declared `sealed` has an explicit `permits` list of subclasses. The hierarchy is closed, enabling exhaustive pattern matching.

**Q32. What modifiers must a sealed class's subclasses use?**
A: One of `final`, `sealed`, or `non-sealed`. The first two close the hierarchy further; the third explicitly reopens it.

**Q33. What's the difference between sealed and final?**
A: `final` allows zero subclasses. `sealed` allows a controlled list. Both prevent unbounded extension.

**Q34. What is pattern matching for `instanceof`?**
A: Java 16 feature: `if (a instanceof Dog d) { d.bark(); }` — combines the type test with a binding. Eliminates the explicit cast.

**Q35. What is pattern matching for `switch`?**
A: Java 21 feature: `switch (x) { case Dog d -> ...; case Cat c -> ...; }`. With sealed types, the compiler enforces exhaustiveness.

**Q36. Why is sealed + pattern matching better than the visitor pattern?**
A: Less boilerplate, type-safe, exhaustive. Visitor still useful for open hierarchies.

**Q37. What is "exhaustiveness" in pattern matching?**
A: The compiler verifies that every case the type can be is handled. Adding a new permitted subclass forces every switch over the sealed type to be updated.

**Q38. What are "guarded patterns" in switch?**
A: Patterns with a `when` clause: `case Dog d when d.weight > 30 -> "big dog";`. Add boolean conditions after the pattern.

**Q39. Can sealed types span modules?**
A: No (in named modules). Permitted subclasses must be in the same module. In unnamed modules, same package.

**Q40. What's the bytecode for a sealed class?**
A: A `PermittedSubclasses` attribute listing the allowed direct subclasses. The verifier enforces it.

---

## Section E — Edge cases & advanced (41-50)

**Q41. What is a covariant return type?**
A: An override declares a return type that is a subtype of the parent's return type. The compiler synthesizes a bridge method to preserve binary compatibility.

**Q42. Can constructors throw exceptions?**
A: Yes. The exception propagates and the object is never returned. Half-built state is unreachable but its resources may leak unless explicitly cleaned up.

**Q43. Can you have a `static abstract` method?**
A: No. `static` methods aren't dispatched polymorphically, so there's nothing for `abstract` to defer.

**Q44. What is a bridge method?**
A: A compiler-synthesized method that bridges between erased generic signatures or covariant return types. Lets parent-typed callers see the parent-shaped signature.

**Q45. Why doesn't a child constructor inherit?**
A: Constructors initialize the type, not its members. Inheriting them would let you create instances of subclasses with parent-only logic, possibly missing required subclass setup.

**Q46. What happens if a parent constructor calls an overridable method?**
A: Polymorphism dispatches to the subclass's override, but the subclass's fields haven't been initialized yet — they're at default values. Famous source of NPEs.

**Q47. How does multiple-interface inheritance with conflicting defaults resolve?**
A: Class wins over interfaces. Among interfaces, more specific wins. If two are unrelated, the implementing class must override and disambiguate, often using `Interface.super.m()`.

**Q48. Is `Iterable<String> <: Iterable<Object>`?**
A: No — generics are invariant. Use `Iterable<? extends Object>` for covariance.

**Q49. What does "binary compatibility" mean for inheritance?**
A: A subclass compiled against an old parent should still work when run against a new parent (within compatible changes). Bridge methods, covariant returns, and added interfaces preserve binary compat.

**Q50. What is JEP 482 (flexible constructor bodies)?**
A: Java 22+ preview: allows statements before `super(...)` in the constructor, as long as they don't reference `this`. Makes argument validation cleaner.

---

## Bonus — open-ended (51-60)

**Q51. Walk me through what happens when you call `myCircle.area()` where Circle extends Shape.**
A: Compiler emits `invokevirtual #area`. JVM resolves the method symbolic reference to a vtable slot. At runtime, reads `myCircle`'s klass pointer, indexes the klass's vtable at that slot, calls the function pointer. JIT may inline if monomorphic.

**Q52. How would you redesign a deep `Animal → Mammal → Dog → Poodle` hierarchy?**
A: Most likely with composition: `Dog` *has-a* `Vocalizer`, `Mover`, `Diet`. Replace inheritance with delegation. Use sealed types only if the categories are genuinely closed (e.g., `Shape` is). For most real domains, "is-a" doesn't hold strictly enough to justify deep extension.

**Q53. Should I subclass `ArrayList` to add a method?**
A: Almost never. You inherit every `ArrayList` method (including ones that violate your invariants). Compose: hold an `ArrayList` and forward only the methods you want.

**Q54. Why is `Stack` (java.util) considered a design mistake?**
A: It extends `Vector`, exposing all vector methods (`elementAt`, `set`, etc.) that violate stack discipline. Stack should have been composed, not extended.

**Q55. How would you implement a graph node hierarchy with sealed types?**
A:
```java
sealed interface Node permits Constant, Variable, BinaryOp { }
record Constant(double value) implements Node { }
record Variable(String name) implements Node { }
record BinaryOp(Node left, Op op, Node right) implements Node { }
```
Then traversal/eval becomes a single exhaustive switch.

**Q56. When would you choose abstract class over interface?**
A: When you need shared *state* (instance fields) plus shared *behavior*. Otherwise, interface + composition.

**Q57. What if a class implements two interfaces with the same method but different return types?**
A: Compile error unless the return types are compatible (one is a subtype of the other; covariance applies).

**Q58. How do you test a class hierarchy?**
A: Write contract tests for the parent (any subclass passing them is LSP-compliant). Each subclass extends the contract test class and provides its own factory. Common pattern in JDK collections testing.

**Q59. What's the runtime behavior of `obj.getClass()`?**
A: Returns the actual runtime class, not the declared type. `Object o = "hi"; o.getClass()` returns `class java.lang.String`.

**Q60. Why are arrays covariant in Java but generics invariant?**
A: Arrays predate generics and were retrofitted with covariance, leading to the unsoundness `ArrayStoreException`. Generics learned from this mistake and chose invariance, with explicit wildcards for variance. Modern guidance: prefer collections over arrays in APIs.

---

**Use this list:** mix one Q from each section. Strong signal: the candidate explains *why*, not just the rule.
