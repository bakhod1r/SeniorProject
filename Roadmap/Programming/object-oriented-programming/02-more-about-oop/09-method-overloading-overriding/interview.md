# Method Overloading / Overriding — Interview Q&A

50 questions on the two mechanisms, their rules, and their runtime behavior.

---

## Section A — Basics (1-10)

**Q1. What is method overloading?**
A: Multiple methods with the same name but different parameter lists in the same class.

**Q2. What is method overriding?**
A: Providing a new implementation in a subclass for a method inherited from the parent.

**Q3. When is overloading resolved?**
A: Compile time, based on the static (declared) types of the arguments.

**Q4. When is overriding resolved?**
A: Runtime, based on the actual class of the receiver.

**Q5. Can two methods overload by changing only return type?**
A: No. Return type alone is insufficient to differentiate methods.

**Q6. Can two methods overload by parameter names?**
A: No. Parameter names are not part of the signature.

**Q7. Can two methods overload by throws clause?**
A: No. Throws is not part of the signature.

**Q8. Can a private method be overridden?**
A: No. Private methods are invisible to subclasses; same-named subclass methods are independent.

**Q9. Can a static method be overridden?**
A: No, only *hidden*. Static dispatch is at compile time.

**Q10. Can a final method be overridden?**
A: No. `final` forbids overriding.

---

## Section B — Rules (11-20)

**Q11. What's a covariant return type?**
A: An override returns a subtype of the parent's return type. The compiler synthesizes a bridge method to preserve binary compatibility.

**Q12. Can the override declare wider throws?**
A: No. Override's throws clause must be a subset (in subtype terms) of the parent's checked exceptions.

**Q13. Can the override declare narrower access?**
A: No. Access must be the same or wider.

**Q14. What does `@Override` do?**
A: Tells the compiler "this method overrides a parent's method." If it doesn't actually override, compile error.

**Q15. Can constructors be overridden?**
A: No. Constructors aren't inherited and aren't overridden.

**Q16. Can constructors be overloaded?**
A: Yes. Multiple constructors with different parameter lists in the same class.

**Q17. What happens if the override calls `super.m()`?**
A: Calls the parent's implementation directly (invokespecial), regardless of any further overrides.

**Q18. Can the same method be both overloaded and overridden?**
A: Yes. A class can have multiple overloads of the same name; each can be overridden separately by subclasses.

**Q19. What's the cost of overloading at runtime?**
A: Zero. Overloads are different methods in bytecode; selection is at compile time.

**Q20. What's the cost of overriding at runtime?**
A: A vtable lookup (~1-5 ns). JIT often devirtualizes to direct calls.

---

## Section C — Resolution (21-30)

**Q21. What are the three phases of overload resolution?**
A: Strict (no boxing), loose (allow boxing), variable-arity (allow varargs). First phase to find an applicable method wins.

**Q22. What happens if multiple methods are applicable in the same phase?**
A: The most specific is chosen. If none is more specific than another, ambiguous → compile error.

**Q23. Why does `m(5)` call `m(int)` not `m(Integer)`?**
A: Phase 1 (strict) finds `m(int)` directly (exact match). Boxing isn't needed.

**Q24. What if the only match requires boxing?**
A: Phase 2 finds it. `m(Integer x)` is selected after phase 1 fails.

**Q25. What if there's a varargs and a fixed-arity match?**
A: Fixed-arity wins (phase 1 or 2 selects it before phase 3).

**Q26. Does the compiler infer types based on what method exists?**
A: Sort of. Type inference for generics happens during overload resolution. The compiler doesn't pick the method "wishfully" — it follows the algorithm.

**Q27. Can you overload `void m(int)` and `void m(Integer)`?**
A: Yes. They have different descriptors.

**Q28. Can you overload `void m(List<String>)` and `void m(List<Integer>)`?**
A: No. After erasure, both are `m(List)`. Compile error.

**Q29. Why does `m(null)` sometimes give compile errors?**
A: If multiple overloads accept `null` (e.g., `m(String)` and `m(Object)`), it's ambiguous — both apply. Cast: `m((String) null)`.

**Q30. What's the difference between override-equivalent and same-erasure?**
A: Same-erasure is a special case used in the override-equivalent rule. Two methods with same erasure but different generic signatures are override-equivalent (and one is treated as overriding the other).

---

## Section D — Polymorphism & dispatch (31-40)

**Q31. Why doesn't this code dispatch to the subclass?**
```java
class Parent { void m(Object o) { ... } }
class Child extends Parent { void m(String s) { ... } }
Parent p = new Child();
p.m("hi");
```
A: `Child.m(String)` is an *overload*, not an override. `Parent.m(Object)` is in the vtable; `String` widens to `Object`; dispatch goes to `Parent.m`.

**Q32. How do you make this work?**
A: Override `m(Object)` in Child:
```java
class Child extends Parent { @Override void m(Object o) { ... } }
```

**Q33. Why is `@Override` important?**
A: It catches signature mistakes at compile time. Without it, the compiler treats your method as a separate overload.

**Q34. What's vtable dispatch?**
A: At runtime, the JVM looks up the receiver's class's method table at a precomputed slot, then invokes.

**Q35. What's an inline cache?**
A: The JIT records the receiver class at each virtual call site. Monomorphic = one class seen, JIT inlines. Megamorphic = 3+, falls back to vtable.

**Q36. How does the JIT devirtualize?**
A: Class hierarchy analysis (CHA) — if no overrider is loaded, the call is effectively direct. Final classes/methods are always devirtualizable.

**Q37. What's the cost of megamorphic dispatch?**
A: ~5-10 ns vs ~1 ns monomorphic. JIT can't inline megamorphic.

**Q38. What's a bridge method?**
A: A compiler-synthesized method that bridges erased generic signatures or covariant returns to preserve binary compatibility.

**Q39. Why are bridge methods needed?**
A: Without them, callers expecting the parent's signature couldn't dispatch to the override (different descriptors after erasure).

**Q40. Are bridge methods slower?**
A: Negligibly. JIT inlines through them, eliminating the indirection at hot paths.

---

## Section E — Edge cases (41-50)

**Q41. Can a method override and overload at the same time?**
A: Yes. A subclass can have both an override of one parent method and an overload of another.

**Q42. Why can't you override based on return type only?**
A: Bytecode method dispatch uses (name, params), not (name, params, return). Two methods with same name+params but different returns would conflict.

**Q43. Can an override change a parameter type?**
A: No — that's an overload. Override requires identical parameters.

**Q44. What's the relationship between overriding and Liskov?**
A: An override should honor the parent's pre/post-conditions and invariants. Otherwise, callers using the parent type are surprised.

**Q45. Can a default method on an interface be overridden?**
A: Yes. The override takes precedence; the default is shadowed.

**Q46. What if a subclass implements an interface whose default conflicts with a parent's method?**
A: The class's method (or inherited) wins over the interface default.

**Q47. Can `protected` methods be overridden in a different package?**
A: Yes — the subclass can override and even widen access to public.

**Q48. Why can't I override a method declared in a `final` class?**
A: You can't extend a final class, so you can't have a subclass to override in.

**Q49. Can an enum constant override an abstract method declared on the enum?**
A: Yes — that's the strategy enum pattern. Each constant provides its own implementation.

**Q50. Why is overload resolution sometimes called "compile-time polymorphism"?**
A: Because the same name maps to different methods based on argument types. It's "polymorphism" in a loose sense, distinct from runtime polymorphism (overriding).

---

## Bonus — staff (51-55)

**Q51. How would you migrate a public method to a wider parameter type?**
A: Add the wider overload first. Make the narrow version delegate to the wider. Deprecate the narrow. Eventually remove (or keep for binary compatibility).

**Q52. What's the relationship between overloading and ambiguity in JDK collections?**
A: `Collection.remove(Object)` and `List.remove(int index)` are different overloads. Calling `list.remove(5)` removes index 5, not the value 5 — common surprise.

**Q53. How do you test for unintended overload behavior?**
A: Code review with `@Override` everywhere; integration tests that exercise polymorphic call sites; tools like Error Prone that flag suspicious overload patterns.

**Q54. Should you ever override `equals` without `hashCode`?**
A: Never. The contract requires consistency. Records and Lombok @EqualsAndHashCode handle both correctly.

**Q55. What's the future of overloading in Java?**
A: Pattern matching reduces some need (variant dispatch via sealed switch). But name-based overloading remains as a core mechanism. Generic specialization (Project Valhalla) may add primitive overloads automatically.

---

**Use this list:** strong candidates can articulate *why* the rules exist, not just state them. Reach for `@Override`, `final`, sealed types as design tools.
