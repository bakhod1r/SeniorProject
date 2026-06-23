# Method Chaining — Interview Q&A

50 questions on chaining patterns, builder design, fluent APIs, and the trade-offs.

---

## Section A — Basics (1-10)

**Q1. What is method chaining?**
A: Calling multiple methods in a single expression by having each method return a value that's a valid receiver for the next call.

**Q2. What does each chained method need to return?**
A: Either `this` (mutating chain) or a new instance whose type the next method exists on (functional chain).

**Q3. What's the difference between mutating and functional chaining?**
A: Mutating: returns `this`, the same instance is modified through the chain. Functional: each call returns a new instance, original is unchanged.

**Q4. Give an example of a mutating chain in the JDK.**
A: `StringBuilder` — `new StringBuilder().append("a").append("b").reverse()`.

**Q5. Give an example of a functional chain.**
A: String operations — `"hello".trim().toUpperCase().replace(' ', '_')`. Each call returns a new String.

**Q6. What is the Builder pattern?**
A: A creational pattern where a separate Builder object collects configuration via chained setters, then `build()` produces the target object. Common when an object has many optional parameters.

**Q7. Why use a Builder instead of constructor with many parameters?**
A: Constructors with 5+ params are unreadable. Builders make each parameter explicit and named at the call site, support optional parameters, and enable validation in `build()`.

**Q8. What is the staged builder pattern?**
A: Each step returns a different type, exposing only methods valid at that stage. Used to enforce required-field order at compile time.

**Q9. Are streams a chaining pattern?**
A: Yes. `stream().filter(...).map(...).collect(...)` chains stream operations. Each intermediate step returns a new Stream.

**Q10. Are streams mutating or functional chains?**
A: Functional — each step returns a new Stream view. The original collection is not modified.

---

## Section B — Design (11-20)

**Q11. When should a method return `this`?**
A: When the method is part of a fluent API meant to be chained, and the receiver is the natural recipient of the next call. Most commonly in builders and stateful pipelines.

**Q12. What's the danger of mixing mutation and chain returns?**
A: Callers may not realize they're holding the same mutable instance. They may share it, mutate it via one reference, and surprise other holders. Document clearly that the chain is single-threaded and single-use.

**Q13. How do you handle optional fields in a chain?**
A: Either (a) provide setters with sensible defaults; (b) require them in the constructor before chaining starts; or (c) use staged builder for compile-time enforcement.

**Q14. What's the difference between a fluent API and a DSL?**
A: A fluent API is any chainable API. A DSL (Domain-Specific Language) is a fluent API designed to read like the domain's language — often using staged types and method names that mirror domain vocabulary.

**Q15. What's the cost of a staged builder?**
A: Many small interface types; each step has its own type. Cognitive load for maintainers. Refactoring requires touching many types. Use only when type-driven enforcement is justified.

**Q16. How do generic self-types help with chained inheritance?**
A: `class Animal<T extends Animal<T>>` lets the parent return `T`, which is the actual subclass type. So `new Dog().name("Rex").bark()` works — `name` returns `Dog`, not `Animal`.

**Q17. What's wrong with `class Animal { Animal name(String) { return this; } }` for inheritance?**
A: A subclass `Dog`'s `dog.name("Rex")` returns `Animal`, losing the subclass type. Subsequent `.bark()` fails to compile.

**Q18. Should chains modify shared state?**
A: Generally no. Mutating chains modify their builder, but the builder should not be shared. Functional chains can be safely shared.

**Q19. Are streams thread-safe?**
A: Stream operations are not thread-safe in the sense of "many threads using the same stream." Each stream should be consumed by one thread. Use `parallelStream()` for parallelism.

**Q20. What's the difference between `Stream.peek` and `Stream.map`?**
A: `peek` is a debugging hook with no transformation; useful for logging. `map` transforms. Don't use `peek` for production logic.

---

## Section C — Implementation (21-30)

**Q21. What does `return this` compile to?**
A: A few bytecodes: `aload_0` then `areturn`. JIT inlines aggressively.

**Q22. Are chains slower than direct calls?**
A: Almost never, after JIT warmup. The JIT inlines tiny chain methods into the caller, producing equivalent machine code.

**Q23. Does each step in a Stream pipeline allocate?**
A: Each intermediate operation allocates a wrapper (`StatelessOp` or similar). The terminal op runs the chain. Allocations are typically eliminated by escape analysis or are short-lived enough to die in eden.

**Q24. Do lambdas allocate per chain call?**
A: Non-capturing lambdas allocate once (cached). Capturing lambdas may allocate per call site invocation; the JIT can sometimes scalar-replace these.

**Q25. What's `invokedynamic` got to do with chaining?**
A: Lambdas (used heavily in stream chains and DSLs) compile to `invokedynamic`, which lazily generates a hidden class implementing the functional interface. The chain itself uses regular `invokevirtual`/`invokeinterface`.

**Q26. How does `Stream.toList()` (Java 16+) differ from `collect(Collectors.toList())`?**
A: `toList()` directly drains into an unmodifiable list. Skips Collector overhead. Result is unmodifiable.

**Q27. What is "stream fusion"?**
A: The JVM's ability to inline an entire stream pipeline into a single tight loop. Requires non-capturing/stable lambdas and small enough method bodies.

**Q28. Why might a chain be slower than a hand loop on `int[]`?**
A: Stream pipelines incur per-element abstraction (Sink wrappers, lambdas). Hand loops can use auto-vectorization and tight register usage. For numeric kernels, hand loops can be 2-10× faster.

**Q29. What's the cost of `CompletableFuture.thenApply` vs synchronous call?**
A: Each `thenX` allocates a `Completion` node and a wrapper. Adds tens to hundreds of nanoseconds per step. Worth it when async actually parallelizes; wasteful in synchronous code.

**Q30. How do you debug a long chain?**
A: Break into named intermediates, use `peek` (Stream) or custom `tap`, or split into smaller methods. Long chains hide failure points.

---

## Section D — Patterns & idioms (31-40)

**Q31. What's the Builder pattern's terminal step?**
A: `build()`. Returns the final immutable object. By convention, the builder is single-use after `build()`.

**Q32. Should `build()` validate?**
A: Yes. It's the last chance to verify all required fields are set and are consistent. Throw `IllegalStateException` for invalid configurations.

**Q33. What's the "dual" of a builder?**
A: A factory method that takes all required fields directly: `Pizza.of("large", List.of("mushrooms"))`. Cleaner when there are few required parameters.

**Q34. How do you make a builder reusable across a chain?**
A: Create a `Builder.copy()` method that returns a duplicated builder, or a `toBuilder()` on the target type that initializes a builder from current state. Useful for "create variant of X" use cases.

**Q35. What does `.withX()` mean in records?**
A: Convention for "return new record with field X changed." Until JEP 468 lands, you write these manually.

**Q36. What's the Comparator chaining pattern?**
A: `Comparator.comparing(...).thenComparing(...)` — returns a new Comparator that breaks ties. Each step is functional, returning a new Comparator instance.

**Q37. What's `Optional.flatMap` for?**
A: Chain Optionals where each step itself returns Optional. Avoids `Optional<Optional<T>>` nesting.

**Q38. What's the danger in `null`-returning calls in a chain?**
A: NPE at the next step. Either return Optional, throw early, or use safe navigation. Don't return null from chained methods — it breaks the contract.

**Q39. Should every chain end with a side effect?**
A: Functional chains often end with `collect`, `reduce`, `forEach`, `orElse`, etc. The terminal step is what produces the user-visible result. Side effects (logging, persistence) usually happen there.

**Q40. What's the contract of a fluent API in tests?**
A: A test using a fluent API often reads like a sentence describing the assertion. AssertJ: `assertThat(list).hasSize(3).contains("a").doesNotContain("b")`. Test contracts: chain reads as a single thought.

---

## Section E — Open-ended (41-50)

**Q41. Walk me through designing a fluent HTTP client builder.**
A: Decide entry point (`HttpClient.builder(url)`). Required fields go to the entry. Optional via setters returning the builder. Common groups: timeouts, headers, body. `build()` returns immutable client. Use a separate `RequestBuilder` for each request to avoid sharing state.

**Q42. When would a staged builder be wrong?**
A: When the builder has many optional fields with no required order. Staged builders shine when 2-4 required fields must be set in order. With 10+ optionals, the type explosion isn't worth it.

**Q43. How does the `java.time` API design chains?**
A: Functional — every "modify" returns a new immutable instance. `LocalDate.now().plusDays(5).withYear(2026)`. Each step is a fresh object. Backed by careful immutability and well-named methods.

**Q44. Why is `java.util.Calendar`'s API painful compared to `java.time`?**
A: Calendar uses mutating setters with magic constants (`Calendar.YEAR`). No chain support. Mistakes are silent. java.time fixed this with immutable types and explicit method names.

**Q45. How do you avoid Demeter violations with chained accessors?**
A: Don't expose internal structure via accessors. Instead, ask the object to do the work: `order.shippingCity()` not `order.address().city().name()`.

**Q46. How do you handle optional steps in a chain?**
A: Conditional helpers like `when`/`apply`/`tap`, or break the chain and use named intermediates: `var b = builder().x(1); if (cond) b.y(2); return b.build();`.

**Q47. What's a "method chain that should be a method"?**
A: A chain repeated in many places. Extract to a single method. Keeps DRY; if the chain logic changes, update one place.

**Q48. How does Mockito's fluent API work?**
A: Stateful builder pattern: `when(mock.method()).thenReturn(value)`. `when` captures the next call into the mock; `thenReturn` configures it. Internally tracks state per stub.

**Q49. What's the difference between Stream and Reactor (Mono/Flux)?**
A: Stream is synchronous, pull-based. Reactor is async, push-based with backpressure. Both use chained operators. Reactor handles unbounded async streams; Stream handles bounded sync data.

**Q50. What's your rule for when to use chains?**
A: Use them when the chain reads as a single thought (transformation, configuration). Avoid them when the chain hides workflow or scatters error handling. Limit to 5-6 calls; longer chains become opaque.

---

## Bonus — staff/architect (51-55)

**Q51. How would you design a fluent SQL DSL?**
A: Staged types per clause (`Select` → `From` → `Where` → ...). Each step returns the next stage's type. Like jOOQ. Pro: compile-time SQL. Con: enormous API surface.

**Q52. Trade-offs of chained mutation vs immutable copy?**
A: Mutation: cheap allocation, simpler code, but stateful and not thread-safe. Immutable copy: harder for the JIT in some cases, but clean semantics, thread-safe, easier to reason. Records make immutable copy cheap.

**Q53. How do you keep chain documentation manageable?**
A: Document the *terminal* method most thoroughly. Each chainable setter has one-line javadoc. Examples in the class-level comment. Don't repeat method-level docs.

**Q54. What's an anti-pattern you've seen in fluent APIs?**
A: Chains that mix mutation and creation. Chains that throw mid-stream without cleanup. Builders that aren't single-use but document themselves as such. Chains 20+ calls long.

**Q55. When would you rewrite a chain to a sequence of statements?**
A: When the chain has more than ~5 hops and isn't a transformation pipeline; when stack traces become unhelpful; when each step has different error semantics; when a maintainer can't predict which step will fail.

---

**Use this list:** answer aloud. Strong candidates explain the trade-offs, not just the rules.
