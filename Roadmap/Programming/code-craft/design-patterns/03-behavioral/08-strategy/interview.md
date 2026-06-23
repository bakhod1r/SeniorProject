# Strategy — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/strategy](https://refactoring.guru/design-patterns/strategy)

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

### Q1. What is the Strategy pattern?

**A.** A behavioral pattern that defines a family of interchangeable algorithms behind a common interface, and lets the caller select which one to use at runtime. The Context holds a reference to the strategy and delegates the work; concrete strategies implement the algorithm.

### Q2. What problem does it solve?

**A.** Hardcoded `if/else` or `switch` chains that pick between algorithm variants. Strategy replaces them with polymorphism: each variant is a class implementing the same interface, the Context holds one, and selection is done outside.

### Q3. What's the difference between Strategy and Decorator?

**A.** Strategy *replaces* the algorithm: the Context calls one strategy, period. Decorator *adds behavior*: it wraps another implementation and forwards (with extra work). Strategy is "pick one"; Decorator is "stack many."

### Q4. Give a real-world example.

**A.** `Comparator` in Java sort, payment processors (Stripe / PayPal / Crypto), compression algorithms (gzip / zstd / brotli), authentication methods (JWT / OAuth / Basic), routing modes (fastest / shortest / scenic).

### Q5. Why does the Strategy interface need to be small?

**A.** Every concrete strategy must implement it. A bloated interface forces strategies to write methods they don't need, leading to dummy implementations. The single-responsibility principle: one method per Strategy interface is ideal.

### Q6. When would you use a function instead of a class for Strategy?

**A.** When the algorithm is one expression and carries no state — e.g., a `Comparator`, a key function for `sorted`, a discount formula. Modern languages (Java 8+, Kotlin, Python, Go) make this idiomatic.

### Q7. What does "composition over inheritance" mean here?

**A.** Instead of subclassing the Context to vary the algorithm, you compose it with a strategy object. Easier to swap, easier to test, less hierarchy. Strategy is the canonical example.

### Q8. What's the Context in Strategy pattern?

**A.** The class that holds a reference to a Strategy and calls its method. It doesn't know — or care — about which concrete strategy is plugged in.

### Q9. When should you NOT use Strategy?

**A.** When there's only one algorithm and no plan to add more — premature abstraction. When the variants share too little contract to fit one interface. When the choice is fixed at compile time and never changes.

### Q10. Can Strategy be stateless?

**A.** Yes — and it usually should be. A pure Strategy is thread-safe by default, can be shared, and is trivial to test. State, when needed, should be confined to the Strategy's own fields (set at construction).

---

## Middle Questions

### Q11. How is Strategy different from State?

**A.** Both delegate to a separate object. *Strategy* is picked by the **caller** and the choice is usually static for the duration of the operation. *State* changes itself (or is changed by transitions); the object's behavior depends on its current state. Strategy is "I picked an algorithm"; State is "I'm in mode X right now."

### Q12. How is Strategy different from Template Method?

**A.** Template Method uses **inheritance** — subclasses override hook methods. Strategy uses **composition** — the Context holds a reference. Strategy is swappable at runtime; Template Method's variation is per-instance / per-subclass.

### Q13. How is Strategy different from Command?

**A.** Strategy encapsulates an **algorithm**: "how to do X." Command encapsulates an **action** to execute later: "do X with this data." Command often has `execute()` + `undo()`; Strategy has the algorithm method. Command is more about queuing / logging / undo; Strategy is about variation.

### Q14. How do you select a strategy at runtime?

**A.** A factory or registry maps a key (string, enum) to a concrete strategy. The Context receives the strategy from this lookup. Avoid `if/else` over the key inside the Context — that defeats the pattern.

### Q15. What's wrong with `Sorter.sort(arr, "quick")`?

**A.** Magic strings. No compile-time check; typos cause runtime errors. Better: `Sorter.sort(arr, SortAlgorithm.QUICK)` (enum) or `Sorter.sort(arr, new QuickSort())` (polymorphic). Both are type-safe; the second extends without modifying `Sorter`.

### Q16. How do you test a Context that uses Strategy?

**A.** Inject a fake / stub Strategy. The Context test verifies *delegation* (called with correct args, return value forwarded). Each real Strategy is tested separately. Don't always go through the Context.

### Q17. What's the trade-off of a class-per-strategy?

**A.** More files, more boilerplate (especially in Java). The benefit: each algorithm is named, isolated, testable, and independently maintainable. For small algorithms, a function works; for configured / multi-step ones, a class wins.

### Q18. Can multiple Contexts share one Strategy?

**A.** If the Strategy is stateless, yes — make it a singleton. If it's stateful (caller-specific config), no — give each Context its own. Sharing stateful strategies leads to subtle bugs.

### Q19. What's a default Strategy for?

**A.** A sensible behavior when the caller doesn't specify. Should be the "safe / common" choice. Avoid silently surprising defaults (slow algorithms, insecure modes).

### Q20. How does Spring's `@Autowired List<Strategy>` relate to Strategy pattern?

**A.** Spring injects all beans implementing `Strategy`. The Context can iterate or pick by an `@Qualifier`. It's idiomatic plugin discovery — adding a strategy = adding a bean, no Context change. Pure OCP application.

---

## Senior Questions

### Q21. How would you swap a Strategy under load without dropping requests?

**A.** Hold the strategy in an atomic reference (`volatile` in Java, `atomic.Value` in Go). Writers replace; readers read each call. Done. If the old Strategy holds resources, drain in-flight calls (counter, `Phaser`) before closing.

### Q22. What's the cost of polymorphic dispatch in a hot loop?

**A.** Monomorphic / bimorphic call sites: ~0-1 ns; the JIT inlines. Megamorphic (3+ types at one site): ~1-3 ns; vtable lookup; no inlining. For 99% of business code: negligible. For tight inner loops: profile, consider type-specialized branches.

### Q23. How do plugin systems use Strategy?

**A.** A Strategy interface lives in a known package. Implementations on the classpath are discovered via SPI (`ServiceLoader`), DI scanning, or explicit registration. Adding a strategy = adding a JAR / bean. The Context never changes.

### Q24. Per-tenant Strategy — design considerations?

**A.** A registry keyed by tenant ID, lazily loaded. Each tenant's Strategy is independent. Concerns: cache eviction (tenants come and go), atomic update when a tenant's plan changes, memory cost (thousands of strategy instances).

### Q25. How do you version a Strategy interface across services?

**A.** Hard problem. Options: dual interfaces (`StrategyV1`, `StrategyV2`) with a default `V2.method = V1.method`. Migrate concrete strategies one by one. Once all moved, remove V1. Across services: coordinate releases or use back-compat shims.

### Q26. Strategy with multiple methods — when does it become a smell?

**A.** When most concrete strategies implement only one or two methods and stub the rest. The Interface Segregation Principle says split. Maybe each "method" is its own Strategy family, and the original was actually two patterns mashed together.

### Q27. How does feature-flag-driven Strategy selection work in practice?

**A.** A flag service (LaunchDarkly, Unleash, GrowthBook) returns a string per request: `getString("payment.processor", userId, "stripe")`. The Context maps that string to a Strategy via a registry. Flips happen in seconds; safe canary deploys; A/B testing built in.

### Q28. What's Open/Closed Principle's role here?

**A.** The Context is *closed* to modification — adding a Strategy doesn't touch its code. It's *open* to extension via the Strategy interface. Strategy is the textbook OCP example.

### Q29. How do you observe which Strategy ran?

**A.** Tag every Strategy with a name (in the interface). Log it on each call, expose via metrics: `strategy_invocations{name="stripe"}`. In distributed traces, add a span attribute. Without this, debugging "which one ran for this request?" is misery.

### Q30. Race conditions when hot-swapping a configured Strategy?

**A.** If config + Strategy are both being updated, you need atomicity. Either:
- Couple them: one atomic ref to a `(config, strategy)` pair.
- Make Strategy hold the config so updating Strategy = updating config.

Updating config in one ref and Strategy in another can lead to readers seeing the new Strategy with old config, briefly.

---

## Professional Questions

### Q31. How does the JVM optimize a monomorphic Strategy call?

**A.** After ~10K invocations, the JIT records the seen type at the call site. Builds a *monomorphic inline cache*: direct call instead of vtable. If the body is small, inlines it. Net cost: same as a regular function call.

### Q32. What is a megamorphic call site, and how does it affect Strategy?

**A.** A site that sees 8+ different concrete types. JIT abandons inline caching; falls back to vtable dispatch. ~2-4 ns per call, no inlining. For dispatchers handling many handler types (tens of strategies), this matters in tight loops.

### Q33. Lambda allocation cost in Java?

**A.** Non-capturing lambdas: cached / shared (one instance for the JVM lifetime). Capturing lambdas: new instance per outer-method invocation. In a hot loop creating closures, this allocates. Hoist the lambda or use a non-capturing form.

### Q34. How does Kotlin `inline fun` differ from a regular Strategy call?

**A.** `inline fun` inlines both the function and its lambda parameter at the call site. No function-call overhead, no lambda object. The trade-off: code bloat (each call site has a copy). Used heavily in Kotlin's stdlib for higher-order functions on collections.

### Q35. Static dispatch (Rust generics) vs dynamic dispatch (`dyn Trait`)?

**A.** Generics are *monomorphized*: one specialized version per concrete type → zero runtime cost, code bloat. `dyn Trait` is a vtable: one shared version, indirect call. Strategy maps cleanly to either; `dyn Trait` for true runtime polymorphism, generics for compile-time variation.

### Q36. Can the JIT inline through `volatile` Strategy reads?

**A.** Yes — the volatile read just enforces visibility; the loaded reference is then used like any other. If the same type is observed at the call site, IC kicks in. The volatile read itself is a memory barrier, not a barrier to inlining.

### Q37. How do you benchmark Strategy dispatch correctly?

**A.** JMH for Java. Vary inputs to defeat constant folding. Use `Blackhole.consume()` to prevent dead-code elimination. Run sufficient warmup (>10K iterations). Compare monomorphic, bimorphic, and megamorphic configurations. Repeat with `-Xint` (no JIT) to see the upper bound.

### Q38. Async Strategy: backpressure considerations?

**A.** A slow Strategy stalls an async pipeline. Each Strategy must respect cancellation, time-bound itself (timeout), and either parallelize or process backpressure-aware. In Reactor: avoid blocking; use `subscribeOn(boundedElastic)` if necessary.

### Q39. Strategy in Go interfaces — itable cost?

**A.** Go interface dispatch goes through an itable lookup. Fast (O(1)), cached after first call. Costs about as much as Java vtable. Negligible except in tight loops.

### Q40. How do you handle Strategy lifecycle when it owns resources?

**A.** Two-phase swap. (1) Atomically replace the reference. (2) Wait for in-flight calls on the old instance to complete. (3) Close the old instance. Without this, you risk closing a Strategy mid-call (NPE / IO error).

---

## Coding Tasks

### T1. Implement a `Comparator`-based Strategy

Sort a list of `Order` objects by:
- price ascending
- price descending
- created_at descending
- price ascending then created_at descending

Use `Comparator.comparing(...)`.

### T2. Pricing engine

Cart with items. Strategies: `StandardPricing`, `StudentPricing` (15% off), `HolidayPricing(rate)` (parameterized). Test each in isolation.

### T3. Strategy registry by string key

Build a `PaymentRegistry` with `register(name, strategy)` and `get(name)`. Add `card`, `paypal`, `crypto`. Throw a clear error for unknown names.

### T4. Strategy + factory

A factory that creates a `RouteStrategy` based on a config string. Test that valid strings produce strategies; invalid ones throw.

### T5. Function vs class Strategy

Implement a discount as a class. Then refactor it to a `Function<Money, Money>`. Compare readability and call-site ergonomics.

### T6. Hot-swap

Build a `Context` whose `setStrategy()` is safe to call from any thread while `execute()` runs concurrently. Verify with a stress test.

---

## Trick Questions

### TQ1. "Strategy with one implementation — is it still Strategy?"

**A.** Technically yes (the pattern just isn't pulling its weight). Practically no — a single concrete behind an interface adds indirection without flexibility. If a second algorithm appears, *then* introduce the abstraction.

### TQ2. "Doesn't `Function<T, R>` make Strategy obsolete?"

**A.** No — it makes the *boilerplate* obsolete. The pattern (separating the algorithm from the Context, swapping at runtime) is exactly what `Function` enables. Strategy = pattern; `Function` = one mechanism to implement it.

### TQ3. "Strategy with `if/else` to pick between strategies — what's wrong?"

**A.** The Context now knows about every concrete strategy. Adding a strategy means modifying the Context. Open/Closed broken. Move the `if/else` to a factory or registry; keep the Context strategy-agnostic.

### TQ4. "Can two strategies share a base class?"

**A.** They *can*, but if they share much, you've stumbled into Template Method territory: extract the shared scaffolding into the base, override hooks for differences. The "Strategy" interface still applies; concrete strategies just inherit shared bits.

### TQ5. "If I add a method to the Strategy interface, all implementations break. Doesn't that violate OCP?"

**A.** Yes — the interface is the contract; changing it is a breaking change. The "open" part of OCP is: add new strategies. The "closed" part is: don't modify the interface or the Context. Java 8+ `default` methods soften this: add new methods with defaults, don't break old strategies.

### TQ6. "Strategy with side effects — is it still pure Strategy?"

**A.** The pattern doesn't require purity. But pure strategies are easier to reason about, share, and test. Side-effecting strategies are fine when warranted (writing to a DB, calling an API), but document carefully.

### TQ7. "Why not just use a `Map<String, Function>` for everything?"

**A.** For trivial algorithms, that's exactly what people do. For algorithms with config, multiple methods, or shared base behavior, a class-based Strategy expresses intent better. Choose based on complexity of the algorithm, not dogma.

### TQ8. "Strategy hidden inside a builder — anti-pattern?"

**A.** Depends. Builders that *configure* a Strategy (`.withPricing(s)`) are clean. Builders that *contain* algorithm logic are smelly — that logic should live in the Strategy.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you replaced an `if/else` chain with Strategy."

Pick a concrete case: pricing rules, payment processors, route planners. Describe the symptom (long branching method, hard to test), the refactor steps, and the win (smaller methods, isolated tests, easier to add a new variant).

### B2. "How do you decide between Strategy and a feature flag?"

Strategy + flag are friends, not rivals. Strategy structures the *code*; the flag picks *which* at runtime. Example: two pricing strategies live in code; the flag selects per request. Without Strategy, you'd flag-toggle inside the algorithm — uglier.

### B3. "We have a god-class doing 5 algorithms. How would you refactor?"

Identify the algorithms by reading the `if/else` (or by reading what *changes* between branches). Extract each into a Strategy. Move the selection out (factory). Leave the Context with its real responsibilities. Iterate.

### B4. "We need to add a new payment processor. What's your approach?"

(1) Define the contract (or reuse the existing Strategy interface). (2) Implement the new processor. (3) Register it. (4) Add tests for the new strategy. (5) Optional: ramp via feature flag for safe rollout. (6) Document in the runbook.

### B5. "Which is more important: design pattern correctness or readability?"

Readability — by a wide margin. Patterns serve readability, not the other way around. A "textbook" Strategy that nobody understands is worse than an inline `if/else` everyone reads.

### B6. "What's the trade-off of using DI to wire strategies?"

DI gives you: declarative wiring, easy substitution in tests, flexible composition. Costs: indirection (where does the Strategy come from?), magic (component scanning), startup time. For small projects, manual wiring is clearer. For large ones, DI saves boilerplate.

---

## Tips for Answering

1. **Start with intent, not class names.** "Strategy is the pattern when you have multiple ways to do one thing and want to swap at runtime."
2. **Always give a concrete example.** Comparator, payment, compression — these are universally familiar.
3. **Distinguish from siblings.** State, Template Method, Command — interviewers love this.
4. **Mention the trade-off.** "It's not free — you pay in classes / files. The win is testability and OCP."
5. **Be honest about modern languages.** Sometimes a `Function` *is* the Strategy.
6. **Performance matters at scale, not always.** Don't pretend it does in business code; do mention it for hot paths.
7. **Tie to SOLID.** Strategy is the canonical OCP / DIP example.
8. **Mention testability early.** It's the most underrated benefit.

[← Professional](professional.md) · [Tasks →](tasks.md)
