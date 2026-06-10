# Static vs Dynamic Binding — Interview Q&A

50 questions on dispatch mechanisms, polymorphism, and JVM internals.

---

## Section A — Basics (1-10)

**Q1. What's the difference between static and dynamic binding?**
A: Static binding is decided at compile time based on declared types. Dynamic binding is decided at runtime based on the receiver's actual class.

**Q2. Which methods use dynamic binding?**
A: Instance methods (non-final, non-private), interface methods, default methods.

**Q3. Which use static binding?**
A: Static methods, private methods, final methods, constructors, `super.method()`, and all field accesses.

**Q4. What's another name for dynamic binding?**
A: Late binding, virtual dispatch, runtime polymorphism.

**Q5. What's another name for static binding?**
A: Early binding, compile-time dispatch, static dispatch.

**Q6. Are fields polymorphic?**
A: No. Field access is statically bound based on declared type.

**Q7. Are static methods polymorphic?**
A: No. Hidden, not overridden.

**Q8. Are private methods polymorphic?**
A: No. Invisible to subclasses.

**Q9. Are constructors polymorphic?**
A: No. Each `new` calls a specific constructor; no inheritance.

**Q10. Is `super.method()` polymorphic?**
A: No. Always dispatches to the immediate parent's method.

---

## Section B — Mechanism (11-20)

**Q11. What's a vtable?**
A: A virtual method table. Each class has one, with method pointers indexed by slot. Override replaces a slot.

**Q12. What's an itable?**
A: An interface method table. A class implementing interfaces has one itable per interface. Slightly slower lookup than vtable.

**Q13. What is `invokevirtual`?**
A: The bytecode opcode for dynamic dispatch on instance methods. Uses vtable.

**Q14. What is `invokeinterface`?**
A: For interface method calls. Uses itable lookup.

**Q15. What is `invokestatic`?**
A: For static methods. Direct dispatch; no receiver.

**Q16. What is `invokespecial`?**
A: For constructors, super calls, and (historically) private methods. Direct dispatch.

**Q17. What is `invokedynamic`?**
A: Bootstrap-resolved dispatch. Used for lambdas, string concatenation, pattern matching, records' equals/hashCode.

**Q18. What's an inline cache?**
A: A per-call-site cache of the receiver class and target method. Enables monomorphic call sites to be inlined.

**Q19. What's monomorphic dispatch?**
A: A virtual call site where only one receiver class has been seen. JIT inlines.

**Q20. What's megamorphic dispatch?**
A: A site with 3+ receiver classes. JIT can't inline; falls back to vtable lookup.

---

## Section C — Optimization (21-30)

**Q21. How does the JIT devirtualize?**
A: Class hierarchy analysis (CHA) — if no overrides are loaded, the call is treated as direct. Deoptimizes if a new override loads.

**Q22. What's the cost of virtual dispatch?**
A: Cold ~5 ns; monomorphic JIT-inlined ~1 ns. Megamorphic ~5-10 ns.

**Q23. Why is `invokeinterface` slower than `invokevirtual`?**
A: Itable search vs vtable index. Marginal in practice; both are inline-cached.

**Q24. How does `final` help dispatch?**
A: Guarantees no overrides; JIT can devirtualize without CHA + deopt support.

**Q25. How do sealed types help dispatch?**
A: Closed set of permitted subtypes; JIT can specialize each case in pattern matching.

**Q26. Does pattern matching switch use dynamic dispatch?**
A: It uses an `invokedynamic` to a typeSwitch classifier — fast, but conceptually dynamic.

**Q27. Can the JIT eliminate dispatch overhead entirely?**
A: For monomorphic, yes — inlining replaces the call with the method body.

**Q28. What's the cost of stacked decorators?**
A: Each decorator is a virtual call. JIT inlines through them if monomorphic. Megamorphic chains lose inlining opportunities.

**Q29. Should you use `final` on every leaf class?**
A: Yes, if not designed for extension. Helps the optimizer and clarifies design.

**Q30. Should you `final` instance methods?**
A: For methods you don't intend to override. Helps document intent and enables reliable inlining.

---

## Section D — Edge cases (31-40)

**Q31. Can you call a static method on an instance reference?**
A: Yes (`instance.staticMethod()`), but it dispatches via declared type. Bad practice; use class name.

**Q32. Why doesn't Java support multiple dispatch?**
A: Java is single dispatch — based on receiver only. Visitor pattern or pattern matching simulates multiple dispatch.

**Q33. What if I call `super.m()` and parent doesn't have `m`?**
A: Compile error: `super.m()` only refers to the immediate parent's `m`.

**Q34. Can you "override" a final method?**
A: No. Compile error.

**Q35. Can you "override" a private method?**
A: No. Same-named subclass method is independent.

**Q36. What's the relationship between covariant return and dispatch?**
A: Covariant return generates a bridge method to preserve the parent's signature for callers. Dispatch can land in either the bridge or the actual override depending on the call site.

**Q37. How does `instanceof` interact with dispatch?**
A: `instanceof` checks the object's actual class. Used to enable downcasting before a static dispatch (legacy) or pattern matching (modern).

**Q38. Are lambdas dynamically dispatched?**
A: After JIT, lambdas call the hidden class's SAM method via `invokevirtual` or `invokeinterface`. Monomorphic; effectively direct.

**Q39. What about `MethodHandle.invokeExact`?**
A: Direct dispatch to the bound method. Often inlined by JIT — same speed as direct call.

**Q40. How does reflection (`Method.invoke`) dispatch?**
A: Through a dynamic mechanism that goes through the JVM's reflection machinery. Slower than direct call (~100x), not JIT-inlinable in the same way.

---

## Section E — Open-ended (41-55)

**Q41. Walk through what happens when you call `myDog.speak()`.**
A: Compile-time: the compiler picks `Animal.speak()` based on declared type, emits `invokevirtual Animal.speak`. Runtime: JVM reads myDog's klass pointer, looks up the vtable slot for `speak`, calls Dog's implementation.

**Q42. How does HotSpot's JIT handle a call site that becomes megamorphic?**
A: Falls back to a vtable lookup. Stops inlining. May log "callee not inlineable" with PrintInlining.

**Q43. Why does `private` use `invokespecial` (or `invokevirtual` since Java 11)?**
A: Private methods aren't overridden. Direct dispatch. Java 11 unified the bytecode by allowing `invokevirtual` for some private dispatches; behavior is the same.

**Q44. How would you profile a megamorphic site?**
A: `-XX:+PrintInlining` shows "failed: callee not inlineable, megamorphic." Async-profiler shows hot vtable lookups.

**Q45. What's the cost of `instanceof` chain vs pattern match?**
A: Chained `instanceof` is sequential class checks. Pattern match is a typeSwitch — single classifier. Pattern is faster and more readable.

**Q46. Does the JIT optimize across multiple dispatch sites?**
A: Yes. With inlining, the JIT can fuse multiple virtual calls into a single inlined block. Especially effective for monomorphic chains.

**Q47. What's profile-guided optimization?**
A: The JIT (or build tool) profiles actual call patterns and specializes for the hot ones. HotSpot does this via inline caches; GraalVM has explicit PGO flags.

**Q48. How does `MethodHandle.invokeExact` differ from reflection?**
A: `MethodHandle` is typed and JIT-inlinable; reflection is untyped (signature-erased) and slow. Modern frameworks use MethodHandle for performance.

**Q49. What's the binding for Spring AOP proxies?**
A: Spring generates dynamic proxies (CGLIB or JDK proxies). Each call goes through the proxy, then to the target. Adds ~100 ns + the actual method.

**Q50. Should you avoid polymorphism for performance?**
A: Generally no. JIT handles monomorphic polymorphism fine. Avoid only when profiling shows megamorphic dispatch is a real bottleneck.

---

## Bonus — staff (51-55)

**Q51. How does JIT know what's monomorphic?**
A: Inline caches profile actual receiver classes at runtime. The JIT reads these profiles to decide whether to inline.

**Q52. What's a "type profile"?**
A: HotSpot's recorded distribution of receiver types at a call site. Used for inlining decisions.

**Q53. Can you force devirtualization?**
A: Mark the class or method `final`. Or use sealed types. Or pattern match to dispatch via static checks.

**Q54. How does ZGC interact with virtual dispatch?**
A: GC and dispatch are orthogonal. ZGC just needs to relocate objects; vtables work the same. Pause times are independent of dispatch type.

**Q55. What's the future of dispatch in Java?**
A: Project Valhalla's value classes have no identity; dispatch may become more predictable. Sealed types and pattern matching push more cases to compile-time-known dispatch. Records are JIT-friendly.

---

**Use this list:** mix questions across sections. Strong candidates explain *why* dispatch is the way it is, not just memorize the rules.
