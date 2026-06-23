# Template Method — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/template-method](https://refactoring.guru/design-patterns/template-method)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Template Method pattern?

**A.** A behavioral pattern that defines the skeleton of an algorithm in a base class and lets subclasses override specific steps without changing the algorithm's structure. The skeleton is fixed; the variable parts (steps / hooks) are filled in by subclasses.

### Q2. What problem does it solve?

**A.** Duplicated algorithm structure across multiple classes. Each variant has the same lifecycle but different details. Template Method extracts the lifecycle to a base class; subclasses focus on what differs.

### Q3. What's the Hollywood Principle?

**A.** "Don't call us, we'll call you." The base class (framework) calls the subclass's hooks, not vice versa. Inversion of control. Template Method is the canonical realization.

### Q4. What's the difference between an abstract step and a hook?

**A.** Abstract: subclass MUST implement. No default. Hook: optional override; default behavior in base class. Subclasses opt-in.

### Q5. What's the difference between Template Method and Strategy?

**A.** Template Method uses inheritance — variation per subclass. Strategy uses composition — variation per object / call. Strategy is more flexible at runtime; Template Method is lighter (no extra objects).

### Q6. Give 5 real-world examples.

**A.** Spring's JdbcTemplate, Java's InputStream, JUnit's TestCase, Servlet's HttpServlet, React class component lifecycle, AWS Lambda handler, Maven build lifecycle, game engine update loops.

### Q7. Why mark the Template Method `final`?

**A.** To lock the algorithm structure. Subclasses fill in steps but can't change the order. Without `final`, subclasses can override the entire template, defeating the pattern.

### Q8. What's a hook with a default no-op?

**A.** A method on the base class that does nothing by default; subclasses opt-in by overriding. Common: `beforeProcess()`, `afterProcess()`. Allows subclasses to add cross-cutting concerns without forcing them.

### Q9. When NOT to use Template Method?

**A.** Single variant (no abstraction needed). Variations independent across multiple dimensions (Strategy fits). Hot path with allocation pressure. Subclasses would override almost every step (no reuse).

### Q10. What's the role of `protected` in Template Method?

**A.** Steps marked `protected` are accessible to subclasses (so they can be overridden) but hidden from external callers (so they can't be invoked out of order). Encapsulates the lifecycle.

---

## Middle Questions

### Q11. How does Spring's JdbcTemplate use Template Method?

**A.** `query(sql, mapper)` is a Template Method: open connection → prepare statement → execute → map rows → close. The lifecycle is fixed; the row mapper is a callback (functional Template Method, no inheritance). User code provides only the mapping.

### Q12. What's a Hollywood Principle violation?

**A.** When the subclass calls into the base class controller methods, instead of letting the controller call the subclass. Mixes responsibilities; obscures control flow. Template Method preserves the principle.

### Q13. How is Template Method related to Factory Method?

**A.** Template Method's algorithm sometimes needs to create objects whose type varies by subclass. The creation step itself is a Factory Method — abstract method returning a product. Common combination.

### Q14. How would you test a class using Template Method?

**A.** Either: instantiate the concrete subclass and test through it (integration-ish). Or: instantiate a minimal test subclass that exposes hooks for verification. The base class isn't directly testable since it's abstract.

### Q15. What's a higher-order function alternative?

**A.** Pass callbacks as parameters to a function. The function is the template; callbacks are hooks. No inheritance.

```java
public <T> T withTransaction(Function<Tx, T> work) {
    Tx tx = begin();
    try { T r = work.apply(tx); commit(tx); return r; }
    catch (Exception e) { rollback(tx); throw e; }
}
```

### Q16. Should hooks call `super`?

**A.** Depends on the contract. Document explicitly. Some hooks REQUIRE super (init pattern); some MUST NOT call super (override semantics). Brittle either way; design hooks to be self-contained when possible.

### Q17. What's hook proliferation?

**A.** A base class accumulates many hooks over time as new subclass needs arise. Becomes config-by-override. Smell — refactor to Strategy or split the template.

### Q18. How does Java's default methods relate?

**A.** Default methods (Java 8+) on interfaces let you provide method bodies. Effectively Template Method without an abstract class. Multiple interfaces with defaults compose; abstract class doesn't (single inheritance).

### Q19. What's an async Template Method?

**A.** Each step returns a future / promise; the template composes them. `thenCompose`, `thenApply` chain. Useful for I/O-bound pipelines without blocking.

### Q20. What's a "concrete step" in Template Method?

**A.** A method already implemented in the base class. Same for all subclasses. Often `private` (subclass shouldn't see) or `final` (subclass shouldn't override).

---

## Senior Questions

### Q21. When would you use Template Method vs middleware chain?

**A.** Template Method: fixed lifecycle with named hook points; subclass per variant. Middleware chain: ordered list of pluggable handlers; multiple stack on one request. Middleware is more flexible (composition); Template Method is more structured (inheritance). Modern frameworks favor middleware.

### Q22. How does React's hooks API relate to Template Method?

**A.** React's reconciler is the Template Method. Function components use hooks (`useState`, `useEffect`) instead of class lifecycle methods. Same principle (framework drives, user code customizes); functional form replaces inheritance.

### Q23. What's a Liskov substitution violation in Template Method?

**A.** A subclass overrides a hook in a way that breaks the base class's expectations. E.g., the base assumes the hook returns non-null; subclass returns null. Or the base catches a specific exception; subclass throws an unrelated one. Template Method requires careful contract design.

### Q24. How do you avoid hierarchy explosion with Template Method?

**A.** Flatten with composition (Strategy for varying parts). Use functional Template Method (callbacks instead of inheritance). Split big templates into smaller ones. Don't subclass to add features; use Decorator.

### Q25. What's a sealed Template Method hierarchy?

**A.** Java 17+ `sealed abstract class permits A, B, C`. The set of subclasses is closed. JIT can specialize; refactoring is safer (adding a subclass requires `permits` update). Compile-time exhaustiveness for switches.

### Q26. Async Template Method with cancellation?

**A.** Each step honors a cancellation token / `CancellationException`. The template's chain (`thenCompose`) propagates cancellation. Subclasses must check cancellation in long-running steps. Standard in Reactor, RxJava, Kotlin coroutines.

### Q27. How does Apache Beam use Template Method?

**A.** `DoFn` defines the lifecycle: `setup → startBundle → processElement* → finishBundle → teardown`. Beam runtime drives; user implements `processElement`. Same code runs on multiple runners (Flink, Spark, Dataflow). Template Method enables portability.

### Q28. Functional Template Method vs inheritance — when each?

**A.** Inheritance: shared state, multi-method lifecycle, framework-defined contracts. Functional: stateless, single-callback, modern style. Most frameworks have evolved toward functional (callbacks, lambdas). Inheritance still useful for stateful lifecycles.

### Q29. What's the impact of inheritance on testability?

**A.** Concrete subclasses must be instantiated to test the lifecycle. Mocking the base is awkward. Functional Template Method is easier to test — pass mock callbacks. Inheritance trades testability for clean OO structure.

### Q30. How do you evolve a Template Method's API safely?

**A.** Adding hooks: safe (add as default no-op). Removing hooks: deprecate first; remove after grace period. Renaming: dual-name (old and new) during transition. Changing contracts: bump version; provide migration path. Treat the base class API like a public library API.

---

## Professional Questions

### Q31. JIT optimization of Template Method dispatch?

**A.** Monomorphic call sites (one subclass observed) → inline cache → direct call → inlined body. Bimorphic also fast. Megamorphic (8+ subclasses) → vtable, ~3ns. For business code: invisible. For tight inner loops: profile.

### Q32. How do default methods on interfaces affect performance?

**A.** Default methods are dispatched through interface tables (slightly slower than vtable for class hierarchy). Modern JIT optimizes well; difference often invisible. Functionally equivalent to abstract class with concrete method.

### Q33. Cost of capturing lambda in Template Method?

**A.** Each invocation with a capturing lambda allocates an object (~16 bytes). For 100M+ calls/sec, GC pressure. Reuse non-capturing lambdas as static finals. JIT can also fold non-capturing lambdas if call site is monomorphic.

### Q34. CompletableFuture overhead in async templates?

**A.** Each `thenCompose` / `thenApply` allocates a new future. ~ns each; cumulative for long chains. Coroutines (Kotlin) often allocate less due to continuation reuse. For request-rate workloads: invisible. For 10M+ ops/s: matters.

### Q35. Sealed classes and JIT?

**A.** Sealed hierarchies tell the JIT the closed set of subtypes. Pattern matching can be optimized to a jump table. Removes uncertainty in inline cache evolution. Modern JIT exploits this; older versions less so.

### Q36. Template Method with state — concurrency considerations?

**A.** Stateful base class fields require synchronization for concurrent calls. Template methods that modify base state need `synchronized` or atomic operations. Stateless templates are concurrent-friendly. Prefer stateless when possible.

### Q37. How does Spring's `@Async` affect Template Method?

**A.** `@Async` causes the method to run on a separate thread / executor. The Template Method itself stays sync; the wrapper is async. Subclasses must honor the threading model — no shared mutable state.

### Q38. What's the cost of inheritance depth on JVM?

**A.** Deeper hierarchies (5+) slow method lookup slightly. Modern JVMs handle well, but deep hierarchies still complicate JIT inline caches. Flat hierarchies inline more aggressively.

### Q39. Why is the Hollywood Principle good for performance?

**A.** Framework-controlled flow allows the framework to optimize: pool resources, batch operations, manage threads. User code just provides hooks; framework chooses when / how to invoke. Less indirection = better optimization potential.

### Q40. How does Rust's trait with default methods compare?

**A.** Rust's traits with default methods are similar to Java interface defaults. Monomorphized at compile time per concrete type → zero-cost abstraction. No vtable for static dispatch (`impl Trait`); vtable only for `dyn Trait`. Best-of-both performance + ergonomics.

---

## Coding Tasks

### T1. Beverage maker

Abstract `Beverage` with `make()` template and abstract `brew()` / `addCondiments()`. Implement Tea, Coffee.

### T2. HTTP request processor

Template: parse → auth → handle → respond. Subclasses implement `handle`.

### T3. Data pipeline

Template: extract → clean → transform → load. Hooks for clean and afterLoad.

### T4. Test framework

Template: setUp → test → tearDown. Subclasses implement `test`.

### T5. Functional template

Convert an inheritance-based template to a higher-order function with callbacks.

### T6. Async template

Template returning `CompletableFuture`. Each step async; chain with `thenCompose`.

### T7. Hooks with required `super` calls

Template that requires `super.onSetup()` in subclass overrides. Document and test.

### T8. Sealed template hierarchy

Java 17+ sealed abstract class with permitted subclasses.

---

## Trick Questions

### TQ1. "Doesn't Template Method violate composition over inheritance?"

**A.** It uses inheritance. The "composition over inheritance" principle says prefer composition when possible. Template Method is the right tool when shared lifecycle and is-a relationship genuinely apply. For everything else, prefer Strategy / composition.

### TQ2. "If I need multiple Templates, can I extend two base classes?"

**A.** No (in single-inheritance languages). Solutions: interface defaults (Java 8+), composition, functional Template Method (callbacks). Multiple inheritance generally avoided due to complexity.

### TQ3. "Why is the abstract step protected, not public?"

**A.** Public would let external code call the step out of order. Protected lets subclasses override; only the base's Template Method invokes it in the correct sequence.

### TQ4. "Can the Template Method be virtual?"

**A.** Yes (without `final`), but it defeats the pattern. Subclass overriding the entire template removes the lifecycle guarantee. The whole point is to lock the structure.

### TQ5. "What's wrong with `protected abstract void prepare();` returning void if it might fail?"

**A.** Failure is silent. Better: throw a checked exception, or return a `Result` type, or have a hook for `onPrepareFailure`. Document failure semantics.

### TQ6. "Why is Template Method called 'inversion of control'?"

**A.** Normally, your code calls library functions. With Template Method, the library (or framework) calls your hooks. Control inverted from "you driving the framework" to "framework driving your code." Hollywood Principle.

### TQ7. "Can a hook have side effects?"

**A.** Yes — they often do (logging, metrics). Document explicitly. A hook the framework expects to be pure should be marked accordingly.

### TQ8. "What if the subclass doesn't need any hook?"

**A.** Then Template Method doesn't add value. Either: the subclass is wrong (should be the base class itself); or the pattern doesn't apply here. Remove the abstraction.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you used Template Method."

Pick concrete: HTTP request processor with auth → handle → log lifecycle. Refactored from spaghetti to base class. Subclasses focus only on handlers. Cross-cutting concerns centralized.

### B2. "How would you design a plugin system using Template Method?"

Base class defines lifecycle (init → process → cleanup). Plugins extend. Framework discovers plugins (SPI / DI / registration); calls them at the right point. Each plugin focuses on its specific behavior.

### B3. "Walk me through a JdbcTemplate-like API."

`query(sql, mapper)` — Template Method handles connection / cursor / cleanup. Caller provides only the mapping. Functional Template Method via callbacks. Trade-off: less type structure, more flexibility.

### B4. "Your team is over-using inheritance. How do you steer toward composition?"

Identify cases where Template Method is genuinely needed (shared lifecycle + is-a). For the rest: Strategy, Decorator, callbacks. Refactor incrementally; introduce alternatives in new code first.

### B5. "How do you handle a Template Method evolving over time?"

Adding hooks: default no-op; safe. Removing: deprecate; migrate subclasses; remove later. Changing contract: bump version; document migration. Treat the base class API like a public library — semantic versioning.

### B6. "Why might you migrate from Template Method to functional pipelines?"

Composability: small pipelines compose into large ones; inheritance hierarchies don't. Testability: callbacks are mocked easily; subclasses harder. Modern languages support functional well. Migrate gradually as hooks proliferate.

---

## Tips for Answering

1. **Lead with intent.** "Template Method locks the algorithm; subclasses fill in variable steps."
2. **Always give a concrete example.** Beverage, JdbcTemplate, HTTP handler.
3. **Distinguish from Strategy.** Inheritance vs composition.
4. **Mention Hollywood Principle.** Senior signal.
5. **Address evolution.** Adding hooks is the lifecycle question.
6. **Functional alternative is modern.** Acknowledge.
7. **Avoid hook proliferation.** Maturity signal.
8. **Sealed types for closed hierarchies.** When language supports.

[← Professional](professional.md) · [Tasks →](tasks.md)
