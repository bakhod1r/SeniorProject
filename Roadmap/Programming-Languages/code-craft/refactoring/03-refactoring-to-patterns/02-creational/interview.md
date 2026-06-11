# Refactoring Toward Creational Patterns — Interview Questions

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

Model answers below. The strongest answers tie the *pattern* to the *smell that drives you to it* — that framing is exactly what Kerievsky's book teaches and what separates a senior answer from a memorized-UML answer.

---

### Q1. What are the advantages of a static factory method over a constructor?

**A.** Four, from *Effective Java* Item 1:

1. **They have names.** `Loan.newTermLoan(...)` says what it builds; `new Loan(...)` cannot disambiguate variants with the same parameter types.
2. **They need not create a new object each call.** They can return a cached/shared instance (`Boolean.valueOf`, `Integer.valueOf` caching small ints) — instance control a constructor can't give.
3. **They can return a subtype** of their return type, including a non-public implementation class. `Collections.unmodifiableList` returns a hidden type; the API exposes only the interface.
4. **They can vary the returned type by input** (e.g. `EnumSet.of` returns a `RegularEnumSet` or `JumboEnumSet` depending on size — invisible to callers).

Trade-offs: classes with only static factories and a private constructor **can't be subclassed** (sometimes a feature — it encourages composition), and static factories are **harder to discover** than constructors (mitigated by naming conventions: `of`, `from`, `valueOf`, `instance`, `newX`).

---

### Q2. Walk me through *Replace Constructors with Creation Methods*. When would you not bother?

**A.** Smell: overloaded constructors a reader can't tell apart, e.g. `Loan` distinguishing term loan / revolver / RCTL only by argument count. Steps: (1) add a named `public static` creation method delegating to a constructor; (2) redirect callers to it; (3) repeat per variant; (4) once nothing calls the constructors, make them `private`. Result is the static-factory idiom — named, intent-revealing construction.

Don't bother when there's a single unambiguous constructor (`new Point(x,y)` needs no `Point.of`), when the class is designed for subclassing via a public/protected constructor, or when you'd need so many creation methods that a **Builder** is the real answer.

---

### Q3. Factory Method vs Abstract Factory — when each?

**A.** **Factory Method** = *one* product type, created via an *overridable method*; subclasses decide the concrete product. You arrive at it by deduplicating sibling subclasses that differ only in one `new`. **Abstract Factory** = a *family* of related products that must stay consistent; one object with several creation methods, one concrete factory per family. You arrive at it when a Simple Factory's methods all branch on the *same discriminator* — lift that discriminator into a type (one factory per value).

Heuristic: one product, vary by subclass → Factory Method. Multiple products that must vary *together* (all-dark UI vs all-light) → Abstract Factory. If families needn't stay consistent, you don't need Abstract Factory's type-enforced coherence — a Simple Factory is lighter.

---

### Q4. Builder vs telescoping constructors — what problem does Builder actually solve?

**A.** Telescoping constructors (`Pizza(size)`, `Pizza(size, cheese)`, …) fail two ways: the call site is unreadable (`new Pizza(12, true, false, true)` — which boolean is what?), and you can't skip a *middle* optional parameter without passing dummy values. As optional fields grow, constructor count explodes combinatorially.

Builder fixes both: named fluent setters make each value self-labeling, optional fields default and are individually settable, and `build()` validates invariants *before* returning — so you can never obtain an invalid partial object. Cost: more boilerplate; not worth it for 2–3 required fields (use a constructor or record). The decisive trigger is *several optional fields + validation*.

---

### Q5. Why is Singleton often called an anti-pattern?

**A.** It bundles two ideas that should be separate: "there is one instance" (a legitimate wiring concern) and "there's a global static access point with enforced uniqueness" (the harmful part). The access point creates **hidden dependencies** — `Foo.getInstance()` inside a method makes the dependency invisible to callers and tests. Mutable Singletons are **global mutable state**, causing **test pollution** (one test dirties it, the next sees it; defeats parallel tests) and **concurrency hazards**. And "exactly one forever" fights you the moment you need one-per-tenant/request/test.

The key insight: a DI container gives you "one instance, injected everywhere" *without* the global access point or hidden dependency. So you usually want **Inline Singleton** — keep the single instance, drop the pattern.

---

### Q6. How does pulling creation into a factory improve testability?

**A.** A class that does `new EmailClient()` internally is welded to a real side effect — you can't test it without sending email. Move that `new` behind an injected factory (or inject the product directly) and the class now *receives* a collaborator you can replace with a stub. The factory is a **testing seam**: pass a fake in tests, the real thing in production. Functional-interface factories (`Supplier<T>`, a one-method interface) make the stub a one-line lambda. This is the same DIP move that decouples production code — testability and good design coincide here.

---

### Q7. You see a factory injected as a constructor dependency, used once. Smell or fine?

**A.** Usually a smell. If the consumer calls `factory.create()` once in its constructor, inject the **already-built product** instead — the factory is needless indirection. Inject a factory (or `Supplier<T>`/`Provider<T>`) only when the consumer must create objects **repeatedly at runtime**, with arguments known only at call time (one-per-request, one-per-row). "Need it once → inject the thing; need to make many → inject the maker."

---

### Q8. What's wrong with double-checked locking, and what should you use instead?

**A.** Without a `volatile` field, DCL is broken: due to instruction reordering, a thread can read a non-null reference to a *partially constructed* object. With `volatile` on the field it's correct in Java 5+, but there are cleaner idioms: the **initialization-on-demand holder** (a private static nested class holding the instance — lazy, thread-safe, lock-free, leaning on the JVM's exactly-once class-init guarantee) or the **enum singleton** (eager, serialization/reflection-safe). Caveat I'd add in interview: getting the locking right doesn't make the Singleton a good idea — it's still a global with hidden dependencies.

---

### Q9. Where does Prototype fit, and why prefer a copy constructor to `Cloneable` in Java?

**A.** Prototype fits when constructing an object is *expensive* but you need many near-identical variants: build the baseline once, then `copy()` and tweak — turning n costly constructions into one construction + n cheap copies (game levels from a parsed template, configs from a computed default). In Java, prefer a **copy constructor or copy factory** over `Cloneable`/`clone()`: `Cloneable` has a broken contract (no `clone` method on the interface, `Object.clone` is protected, it bypasses constructors, and deep-vs-shallow is error-prone) — *Effective Java* Item 13. The risk you trade for: copy correctness (deep-copy mutable nested state, share immutable parts); only adopt when construction cost is *measured*.

---

### Q10. *Move Creation Knowledge to Factory* vs *Extract Factory* — distinguish them.

**A.** Same direction, different scale. **Move Creation Knowledge to Factory**: a *single* collaborator's build/config logic is tangled into a consumer's constructor — move that one recipe to a factory and have the consumer receive the finished collaborator. **Extract Factory**: a class has accreted *several* creation methods (a whole family of products) alongside its real job — lift the cluster out into a dedicated factory class to restore the host's single responsibility. One untangles one dependency; the other splits a [Large Class](../../01-code-smells/01-bloaters/middle.md) along the creation seam.

---

### Q11. In a Spring app, do you still write Singletons and factories?

**A.** Rarely by hand. A default-scoped bean *is* a container-managed singleton — one instance, **injected**, with no `getInstance()`, no hidden dependency, swappable in tests via `@MockBean`. That's the institutionalized Inline Singleton. `@Configuration`/`@Bean` methods are where creation knowledge lives (the framework is the factory); `prototype`/`request` scopes and `ObjectProvider<T>` cover runtime creation. So my creational work in a Spring codebase is mostly (a) replacing hand-rolled singletons/factories with container wiring and (b) keeping the container out of domain types by injecting abstractions, never `ApplicationContext`.

---

### Q12. Is object pooling a good way to reduce GC pressure?

**A.** Almost never for ordinary objects on a modern JVM. Allocation is a few-nanosecond bump-pointer in the TLAB, young-gen collection is cheap, and pooled objects *hurt* by living longer and getting promoted to expensive-to-collect old gen — plus contention and reset bugs. Pool only when construction is genuinely expensive (DB connections, threads, sockets, large native buffers) and the object is resettable. And put the pool *behind a factory interface* so consumers are unaware and you can A/B pooled vs non-pooled. Rule: measure first; pooling is an optimization, not a design.

---

### Q13. Your codebase has `FooFactory`, `BarFactory`, `BazFactory`, each with one `create()` that just calls `new`. Critique.

**A.** Factory sprawl — speculative generality. A factory must "pay rent" by hiding a *choice* (multiple impls), *complexity* (multi-step assembly), or *a seam* (testability). One-method factories that wrap a bare `new` pay none, and they make the code harder to navigate. Fixes: inline them, or replace with a static factory method on the product, or `Supplier<T>`, or let the DI container do startup wiring. Collapse several into an **Abstract Factory** only if they vary *together* as a family. Refactoring *toward* and *away from* patterns is one skill — if a factory stops paying rent, remove it.

---

### Q14. How would you refactor `new` scattered across many clients to a single concrete-class swap point?

**A.** *Encapsulate Classes with Factory*: (1) create a factory with `create(kind)` returning the *interface*; (2) move the selection `if/switch` into it; (3) redirect each client to the factory; (4) drop the concrete classes to **package-private** so nothing outside can `new` them; (5) optionally replace the string discriminator with an enum. Now adding/swapping an implementation is a one-place change, and clients depend on the abstraction — Dependency Inversion. Caveat: don't do it if clients legitimately need the concrete type's extra API, or if there's only one impl with no second in sight.

---

### Q15. Refactoring toward patterns vs designing with patterns up front — what's the philosophy?

**A.** Kerievsky's thesis: patterns are *destinations you evolve toward when the code demands it*, not decorations you apply preemptively. Up-front pattern application risks speculative generality — you pay for flexibility you may never need and obscure the code. Refactoring toward patterns means you wait for a concrete smell (ambiguous constructors, scattered `new`, duplicated creation, telescoping constructors), then apply a small, behavior-preserving, *mechanical* sequence that lands on the pattern. You also refactor *away* when a pattern stops paying its keep (Inline Singleton). The pattern is justified by the smell it removes, never by its own elegance.

---

## Next

- [junior.md](./junior.md) · [middle.md](./middle.md) · [senior.md](./senior.md) · [professional.md](./professional.md)
- [tasks.md](./tasks.md) · [find-bug.md](./find-bug.md) · [optimize.md](./optimize.md)
