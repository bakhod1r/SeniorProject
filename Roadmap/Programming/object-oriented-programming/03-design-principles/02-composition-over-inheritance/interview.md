# Composition Over Inheritance — Interview Q&A

20 questions covering the slogan, the trade-offs, snippet critiques, and senior-level judgement calls.

---

## Q1. What does "favour composition over inheritance" mean, and where does it come from?

It is a design heuristic from the *Gang of Four* book (*Design Patterns*, 1994) and reaffirmed in Joshua Bloch's *Effective Java* (item 18). It says: when you need to reuse behaviour, prefer giving an object a *field* of another type (`has-a`) and delegating, over deriving a subclass (`is-a`). Inheritance is one tool for reuse but it tightly couples the child to the parent's entire public API plus its internal self-use patterns. Composition keeps the coupling explicit and the API surface controllable.

**Follow-up:** "When did this heuristic become important?" — it predates Java; Smalltalk practitioners argued the same point in the 1980s. The reason it gained traction in Java specifically is that Java's single-inheritance plus public-by-default fields made inheritance especially leaky.

---

## Q2. Is inheritance always wrong?

No. Inheritance is the right tool when you need *behavioural substitutability* — a caller written against the parent can use any subclass safely. Three concrete situations: (1) closed type families with exhaustive dispatch (`sealed` interfaces); (2) framework hooks that demand `extends` (`HttpServlet`, JPA `@MappedSuperclass`, JUnit extensions); (3) deliberate polymorphism where the parent was *designed and documented* for extension (Bloch's other rule: "design for inheritance, or prohibit it"). The slogan is "favour", not "always". Reject inheritance only when the substitutability isn't real.

**Trap:** "I refuse all `extends`." Frameworks won't let you. Closed type families lose their compile-time exhaustiveness.

---

## Q3. Critique this snippet.

```java
public class Stack<T> extends ArrayList<T> {
    public void push(T t) { add(t); }
    public T pop()        { return remove(size() - 1); }
}
```

Two problems. First, `Stack<T>` inherits every `ArrayList` method — including `add(0, t)`, `remove(int)`, `clear()`, `subList`. Callers can corrupt the stack invariant. The API surface is far wider than intended. Second, `add` is called internally by `ArrayList.addAll`, so any override of `add` cascades through inherited methods — a self-use trap. Fix: composition. `Stack<T>` holds a `private final ArrayList<T> backing` and exposes only `push`, `pop`, `peek`, `size`.

**Follow-up:** "What's the test that would have caught this?" — assert that `stack.add(0, "X")` does not compile after the refactor.

---

## Q4. What is the "fragile base class" problem?

When a subclass extends a parent, a change to the parent — even one that seems internal — can break the subclass silently. Common shapes: (a) the parent's method now calls another method that the subclass has overridden (self-use changes); (b) the parent adds a new method whose name collides with the subclass's; (c) the parent strengthens an internal precondition that the subclass relied on being loose. The subclass author cannot defend against the parent's evolution without freezing the parent permanently. Composition avoids this because the wrapper holds the parent through a *narrow interface*; only the methods explicitly forwarded are part of the wrapper's surface.

**Follow-up:** "How is this related to LSP?" — fragile base is the *parent-side* version; LSP is the *child-side* version. Both end with broken substitutability.

---

## Q5. Spring's `@Transactional` and inheritance — what's the trap?

`@Transactional` is implemented by a proxy that wraps your bean. When code *outside* the bean calls a `@Transactional` method, the proxy intercepts and starts a transaction. When code *inside* the bean calls another method on `this` — including an inherited method — the call bypasses the proxy and runs without a transaction. Inheritance hides this: an `OrderService extends BaseService` whose `BaseService.save` is `@Transactional` *looks* transactional from `OrderService.process()`, but the intra-class call `this.save(...)` is bypassed. Fix: extract `save` to a separate bean injected by composition. Now the call crosses a component boundary, and the proxy fires.

**Trap:** "Just call it through `((MyService) AopContext.currentProxy()).save(...)`." Works, but exposes the proxy to your code — a coupling you'll regret.

---

## Q6. What's the difference between class adapter and object adapter?

A *class adapter* uses inheritance: the adapter `extends` the adaptee and `implements` the target interface. Concise, but ties the adapter to one adaptee type and steals the only `extends` slot. An *object adapter* uses composition: the adapter `implements` the target and *holds* the adaptee as a field. Slightly more verbose but works when the adaptee is `final`, when the target type is itself a class, when the wrapper needs extra state, or when adapting multiple adaptees. Senior code reviews default to object adapter; class adapter is the special case.

**Trap:** Saying "object adapter is always better." Sometimes the class adapter is one line shorter and equally safe — accept it if the adaptee was designed for extension.

---

## Q7. Default methods are mixins — why aren't they enough to replace composition?

Default methods give *shared behaviour* without inheritance, but they don't give *shared state*. A trait that wants a counter, a cached value, or a configured collaborator still needs a class. Two more limits: defaults colliding across two interfaces force the implementor to override explicitly (the diamond problem in lightweight form), and changing a default body is a *binding change* on every implementor (the fragile-base trap, just at the interface level). They are useful for convenience methods atop a primitive abstract method — `Collection.stream()` is the canonical case — but they don't replace composition for collaborator injection.

**Follow-up:** "When would you use default methods?" — to add a convenience method to an existing interface without breaking implementors; to provide a sensible fallback for a method most implementors don't need.

---

## Q8. Critique this snippet from a composition standpoint.

```java
public class UserService {
    private OrderRepository repo;
    public void setRepo(OrderRepository r) { this.repo = r; }

    public void cancel(Long userId) {
        repo.deleteByUser(userId);
    }
}
```

The field is settable, so the dependency is rewritable after construction. Three consequences: (1) no `final` field publication guarantee — other threads might see the old `repo`; (2) tests have to remember to call `setRepo` before every use; (3) the *invariant* "`UserService` always has a repository" is not expressed in the type. Fix: constructor injection with a `final` field. The dependency is named in the constructor, immutable after, and impossible to forget.

**Trap:** "Setter injection is more flexible." It's more *mutable*, which is the opposite of flexibility for a long-lived service.

---

## Q9. How do records support composition?

A `record` is the shortest possible composed value. It's implicitly `final`, has private final fields per component, and generates `equals`/`hashCode`/`toString` from the components. That means: a record can implement interfaces (composition by type), holds other records or values (composition by field), participates in pattern matching for sealed types, and avoids the `getClass()`-based equality pitfalls of inheritance. Records collapse the boilerplate of value classes and the safety story of immutability into one declaration.

```java
public record Address(String street, String city, String zip) { }
```

**Follow-up:** "When would you not use a record?" — when the type needs to be open for extension (rare, deliberate); when fields must mutate; when the implicit canonical constructor and accessors don't fit (you can still customize, but the value drops).

---

## Q10. What does "self-use" mean, and why is it a hazard for inheritance?

A class engages in *self-use* when one of its public methods calls another of its public methods. `ArrayList.addAll(c)` calls `add(e)` internally; if you subclass `ArrayList` and override `add` to count, `addAll` triggers your counter twice — once explicitly, once through self-use. The hazard is that self-use is part of the parent's *implementation*, not its public contract — and yet it leaks into the override contract. The parent's maintainer can refactor `addAll` to stop calling `add`, and your subclass silently changes behaviour. Composition avoids this because you forward only the methods you choose; internal self-use of the wrapped object stays inside it.

**Trap:** "Document self-use in the parent." Bloch's recommendation, but in practice no team keeps that doc current.

---

## Q11. When is `final` on a class a good default?

When the class isn't designed for extension. *Effective Java* item 19: design and document for inheritance, or prohibit it. `final` prohibits. Most application code falls in the "no extension intended" bucket, so `final` is the right default. It removes the fragile-base risk, lets the JIT devirtualize, and lets callers reason about behaviour with certainty. The codebase-wide policy "every new class is `final` unless we've thought about extension" is enforceable by ArchUnit.

**Trap:** Marking everything `final` *after* the fact and breaking downstream subclasses. Coordinate with consumers when applying `final` retroactively.

---

## Q12. What is "anaemic domain", and how does composition contribute to it?

An *anaemic domain* is one where data classes have only getters/setters and all behaviour lives in service classes that operate on them. The codebase looks compositional — services hold collaborators, entities hold data — but the domain itself has no behaviour. This is a procedural style wearing OO clothes. Composition contributes when it's misapplied as "rip behaviour off the entity class and put it in a service". Composition is for *external collaborators*, not for stripping behaviour off the type that owns the data. `Customer.totalSpent()` is a method, not a service call — unless computing it actually requires injected dependencies.

**Follow-up:** "How do you spot anaemia?" — domain classes with no methods that aren't getters/setters; services whose first argument is always one specific entity.

---

## Q13. Compare composition over inheritance to the Strategy pattern.

Strategy is one *application* of composition: a class holds a `Strategy` interface field and delegates the variable behaviour to it. It's the cleanest case of "compose, don't inherit". The alternative inheritance shape would be `StandardPricingEngine`, `PromoPricingEngine`, `VipPricingEngine` all extending `PricingEngine` — and that locks each variant into a class hierarchy. Strategy keeps `PricingEngine` as one `final` class and lets the variant be a field, swappable at construction time, mockable in tests, composable (one strategy wrapping another).

**Trap:** Confusing Strategy with Template Method. Template Method uses inheritance to fill in the variant; Strategy uses composition. Modern code prefers Strategy.

---

## Q14. How does inheritance hurt testability?

Three ways. (1) Tests that exercise a subclass implicitly exercise the parent — failures could come from either; the test surface is the *union* of both. (2) Mocking a parent's behaviour requires either subclassing or PowerMock-style instrumentation; both are clunky. (3) Construction is forced through the parent's constructor signature — if the parent needs a `DataSource`, every subclass's test does too. Composition makes the seams explicit: each collaborator is an interface, each test injects a fake, and the SUT's behaviour is testable in isolation.

**Follow-up:** "What if the parent is in a library you don't control?" — wrap it in a `final` class that holds a parent instance and exposes only what you need. The wrapper is fully testable.

---

## Q15. Walk me through refactoring a deep hierarchy.

Start by inventorying the tree: `git log` on each level, find which classes change together, name the actual axes of variation. For each leaf, decide: is the parent providing *substitutability* (keep, possibly with sealed) or *reuse* (refactor)? For reuse-driven `extends`: (1) lift the shared behaviour into a `final` collaborator class; (2) inject the collaborator into each former subclass via constructor; (3) replace `super.method(...)` with `collaborator.method(...)`; (4) remove the `extends` and delete the parent. Each step is a reviewable commit. Tests pin behaviour through every step.

**Trap:** Rewriting from scratch. Tempting, almost always wrong; you lose the test suite that captured the old behaviour.

---

## Q16. Default methods can clash. How do you resolve a "diamond" in Java?

If a class `implements I1, I2` and both declare a default method with the same signature, the compiler refuses to choose — the class must override the method explicitly and either implement its own logic or pick one parent with `I1.super.method(args)`. There is no automatic resolution. This is one of the *features* of the default-method design: collisions are loud, not silent.

```java
class C implements I1, I2 {
    public void m() { I1.super.m(); }    // explicit choice
}
```

**Follow-up:** "Why not let the compiler pick?" — the language designers chose explicit because silent resolution would make behaviour depend on declaration order or implementation order, both of which are fragile.

---

## Q17. Should every class have an interface?

No. Interfaces have a cost: a file, an indirection, friction during refactor. Reach for an interface when there's a real reason for a second implementation: an in-memory fake for tests, an alternate adapter (Postgres vs DynamoDB), a service mesh proxy. Don't wrap value types, internal helpers, or anything you'll never swap. An interface without a second implementation is a `IThing/ThingImpl` pair — paperwork, not design. The composition heuristic doesn't demand interfaces; it demands fields that point at the *right* abstraction, which is sometimes a `final` class.

**Trap:** Reflexive `IThing` for every class. Performative DIP, not real composition.

---

## Q18. Critique this snippet — composition without thinking about identity.

```java
public final class CachedRepository<K, V> implements Repository<K, V> {
    private final Repository<K, V> delegate;
    private final Cache<K, V> cache;
    public CachedRepository(Repository<K, V> d, Cache<K, V> c) { delegate = d; cache = c; }
    public V load(K key) { return cache.getOrLoad(key, delegate::load); }
    public void save(K k, V v) { delegate.save(k, v); cache.invalidate(k); }
}
```

The composition itself is fine. The hidden issue: `CachedRepository` doesn't override `equals`/`hashCode`, so two instances of `CachedRepository` wrapping the same delegate are *not* equal. A `Map<Repository<?,?>, Stats>` keyed on repository instances will end up with duplicates after a reconfiguration. Fix: either declare the wrapper as `record CachedRepository<K,V>(Repository<K,V> delegate, Cache<K,V> cache)` to get value equality automatically, or explicitly forward `equals`/`hashCode` to `delegate` if that's the intended semantic.

**Trap:** Assuming inherited `Object.equals` is fine for wrappers. It's almost never fine.

---

## Q19. When does composition lose to performance?

When the wrapper chain is deep, the call site is megamorphic, and the loop body is hot. Symptoms: profiler shows 10–30% in `invokeinterface`; call-site type profile shows 3+ types; flame graph names a decorator chain. Mitigations, in order: (1) wire the chain once at startup, so each call site is monomorphic and the JIT inlines through every layer; (2) collapse cross-cutting wrappers (logging + timing + auditing) into one dispatching layer; (3) for the hottest leaf, accept a concrete dependency for that one call site and document the trade-off; (4) use sealed types + pattern matching instead of open polymorphism when the variant set is closed.

**Trap:** Premature de-composition "for performance". Modern JITs inline monomorphic composition for free.

---

## Q20. What is the "composition checklist" anti-pattern?

Treating composition as five boxes to tick — every class `final`, every collaborator injected, every method on an interface — and shipping. Symptoms: a tiny project with twenty interfaces all having one implementation; constructors with twelve parameters; decorator stacks five layers deep; anaemic domain entities with no methods. The result is *structural noise*: the code "follows the rule" but is harder to read, slower to load, and the domain is invisible. Composition's value is contextual — apply it where it removes a real cost (leaked API, broken substitutability, untestable code), not as a uniform stance.

**Follow-up:** "How do you spot this in review?" — interfaces with one implementor; constructors longer than five parameters; chains where the same wrapper class appears in two different orderings.

---

**Use this list:** rotate one question per axis (slogan, framework `extends`, decorator chain, default methods, identity traps, performance). Strong candidates can name *when not to compose* (frameworks, sealed families, anaemic risk) and back the choice with a concrete trade-off.
