# Refactoring Toward Creational Patterns — Professional Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

Creation is where correctness, performance, and lifecycle collide. A factory you added for testability may allocate on a hot path; a Singleton you "needed" for a shared cache may be the reason a test suite is flaky and non-parallelizable. This level treats creation as a *production* concern.

1. [The cost of `new`: allocation and the JVM](#1-the-cost-of-new-allocation-and-the-jvm)
2. [Object pooling vs factories](#2-object-pooling-vs-factories)
3. [Singleton's hidden costs](#3-singletons-hidden-costs)
4. [Thread-safe lazy initialization done right](#4-thread-safe-lazy-initialization-done-right)
5. [Why Inline Singleton is so often the right move](#5-why-inline-singleton-is-so-often-the-right-move)
6. [Startup-time vs runtime creation](#6-startup-time-vs-runtime-creation)
7. [Framework realities: Spring beans and Guice](#7-framework-realities-spring-beans-and-guice)
8. [Next](#8-next)

---

## 1. The cost of `new`: allocation and the JVM

A creational refactoring almost never changes *how many* objects exist — but it changes *where* and *when* they're created, and that can matter. Know the actual numbers before you optimize:

- On a modern JVM, a small short-lived object allocation is **a handful of nanoseconds** — a bump-pointer in the thread-local allocation buffer (TLAB). Short-lived garbage dies cheaply in the young generation. The folk fear that "`new` is slow" is usually wrong.
- What is *not* cheap: **allocation rate**. Allocating millions of objects per second on a hot path raises GC frequency and pause pressure, evicts cache lines, and can push objects to survive into old gen (allocation-rate-driven promotion). The cost is *aggregate*, not per-object.
- **Escape analysis** can eliminate an allocation entirely if the JIT proves the object never escapes its method (scalar replacement). A Builder used and discarded inside one method may compile down to *no heap allocation at all*. This is why "Builders are wasteful" is usually false in steady state.

The professional consequence: **measure before pooling.** A factory or Builder you added for clarity rarely has measurable allocation cost. Reach for pooling only when a profiler ([profiling-techniques](#)) shows allocation-driven GC pressure on a specific path.

---

## 2. Object pooling vs factories

A factory's default contract is "build a fresh object each call." A **pool** changes that contract to "lend an existing, reset object; reclaim it on return." Pooling is a creational *optimization*, not a *design* — and a dangerous one applied blindly.

Pool **only** when *all* of these hold:

1. Object construction is **genuinely expensive** (OS resources, large buffers, sockets) — not just `new`.
2. The object is **reusable after a reset** to a clean state.
3. The cost of construction dominates the cost of the pool's own bookkeeping and contention.

Canonical legitimate pools: **database connections** ([connection-pooling](#)), **threads** (thread pools), large reusable byte buffers, expensive native handles. For these the construction cost (TCP + TLS handshake, OS thread stack) is thousands of times a plain allocation, and pooling is unambiguously right.

Anti-pattern: pooling **plain POJOs** to "avoid GC." On a modern JVM this almost always *loses* — pooled objects live longer, get promoted to old gen, and turn cheap young-gen collection into expensive old-gen collection, while adding contention and reset-bug risk. The "object pool for ordinary objects" pattern is a relic of pre-generational-GC JVMs.

Refactoring shape: pooling sits *behind* a factory interface, so the consumer is unaware:

```java
interface ConnectionFactory { Connection acquire(); }

class PooledConnectionFactory implements ConnectionFactory {
    private final BlockingQueue<Connection> idle;
    public Connection acquire() {
        Connection c = idle.poll();
        return (c != null) ? c : openNew();   // pool, falling back to create
    }
    void release(Connection c) { c.reset(); idle.offer(c); }
}
```

Because the consumer depends on `ConnectionFactory`, you can swap pooled vs non-pooled *without touching consumers* — the testability seam from [senior.md](./senior.md) doubles as a performance seam.

---

## 3. Singleton's hidden costs

Singleton is the one creational pattern you most often refactor *away from*. Its costs are paid silently in production and in the test suite:

- **Global mutable state.** A Singleton with mutable fields is a global variable wearing a design-pattern costume. Any code can mutate it; reasoning about state becomes non-local. This is the root of most Singleton pain.
- **Hidden dependencies.** `Foo.getInstance()` inside a method means the method's true dependency on `Foo` is invisible in its signature. Callers can't see it; tests can't substitute it. It violates [Dependency Inversion](../../../design-principles/04-solid/05-dip-dependency-inversion/junior.md) — the consumer reaches out to a concrete global instead of receiving an abstraction.
- **Test pollution.** Because the instance is process-global and often mutable, test A mutates it and test B (running later, or *in parallel*) sees the dirty state. Singletons are the leading cause of order-dependent, non-parallelizable test suites. There is frequently no clean way to reset them between tests.
- **Concurrency.** Shared mutable global state is a data-race magnet; every access needs synchronization you didn't plan for.
- **Lifecycle rigidity.** "Exactly one, forever, for the whole process" is rarely the real requirement. The moment you need one-per-tenant, one-per-request, or two-for-a-test, the Singleton's enforced uniqueness fights you.

The crucial distinction: **"there should be one instance" is a deployment/wiring concern, not a reason to bake uniqueness into the class.** A DI container gives you "one instance, injected everywhere" *without* the global access point or the hidden dependency. That observation is what makes Inline Singleton (§5) so often correct.

---

## 4. Thread-safe lazy initialization done right

When a single instance is *genuinely* warranted and must be created lazily (expensive, may never be needed), get the concurrency right. The historically broken approaches and the correct ones:

**Broken — double-checked locking without `volatile`** (pre-Java-5 idiom, still seen):

```java
private static Config instance;            // BUG: not volatile
static Config get() {
    if (instance == null) {                // unsynchronized read
        synchronized (Config.class) {
            if (instance == null) instance = new Config();  // can publish half-built object
        }
    }
    return instance;
}
```

Without `volatile`, another thread can observe a non-null reference to a *partially constructed* object due to instruction reordering. (With `volatile` on the field, DCL is correct in Java 5+ — but there are cleaner idioms.)

**Correct — initialization-on-demand holder** (lazy, thread-safe, lock-free, no `volatile`):

```java
final class Config {
    private Config() { /* expensive */ }
    private static class Holder { static final Config INSTANCE = new Config(); }
    static Config get() { return Holder.INSTANCE; }   // JVM guarantees safe lazy class init
}
```

The JVM's class-initialization semantics give you exactly-once, happens-before-correct, lazy initialization for free. The holder class isn't loaded until `get()` is first called.

**Correct — enum singleton** (eager, serialization- and reflection-safe; *Effective Java* Item 3):

```java
enum Config { INSTANCE; /* methods, fields */ }
```

The professional caveat: getting lazy init *correct* is the easy part. The hard question is whether you should have a Singleton at all (§3, §5). A correct Singleton is still a global. Thread-safety fixes the data race; it does not fix the hidden dependency or the test pollution.

---

## 5. Why Inline Singleton is so often the right move

**Inline Singleton** is Kerievsky's reverse refactoring: when a Singleton's global-access pain outweighs its benefit, *remove the singleton-ness* and pass the object explicitly. It's the headline example of [refactoring away from patterns](../05-refactoring-away-from-patterns/junior.md).

### Starting smell

A Singleton accessed via `getInstance()` from many places, causing hidden dependencies and untestable code — but it holds *no state that actually needs to be globally unique*; uniqueness was a convenience, not a requirement.

### Mechanical steps

1. **Pick the cleanest entry point** (often the composition root / `main` / DI config). Create the single instance there explicitly: `Config config = new Config();`
2. **Add the dependency to consumers** — give each class that calls `Config.getInstance()` a `Config` field set via its constructor.
3. **Replace `Config.getInstance()` calls with the injected field**, one consumer at a time. Run tests after each.
4. **Wire it at the root** — pass `config` down the construction chain (or register it as a single bean in the DI container).
5. **Delete `getInstance()` and the static `instance` field**, make the constructor public/normal.

### Before / After

```java
// BEFORE — global access point, hidden dependency:
class PriceCalculator {
    double total(Cart c) {
        TaxConfig tax = TaxConfig.getInstance();   // hidden, untestable
        return c.subtotal() * (1 + tax.rate());
    }
}

// AFTER — dependency injected, single instance owned by the root:
class PriceCalculator {
    private final TaxConfig tax;
    PriceCalculator(TaxConfig tax) { this.tax = tax; }   // visible, substitutable
    double total(Cart c) { return c.subtotal() * (1 + tax.rate()); }
}
// Composition root creates exactly one and injects it everywhere.
```

You keep the *single instance* (still one `TaxConfig`, owned by the root) but lose the *Singleton pattern* (the global access point and enforced uniqueness). Tests now pass a stub config; the dependency is explicit in the signature; parallel tests stop colliding.

### When NOT to inline

- A handful of truly process-global, **immutable**, stateless utilities (a logger facade, a metrics registry the framework mandates) can stay singletons; the inlining churn buys little.
- Cross-cutting infrastructure the **framework already manages as a singleton** (Spring's single bean) — you already have DI; don't reinvent it.

---

## 6. Startup-time vs runtime creation

A creational design decision often missed: *when* does creation happen?

- **Startup (eager) creation** surfaces configuration errors at boot, not at 3 a.m. under load. Spring's default singleton beans are eagerly instantiated at context startup precisely so a misconfigured bean fails fast. Eager creation trades a slower start for predictable runtime.
- **Lazy creation** defers cost until first use — right for expensive things that may never be needed, but it moves failure into the request path and can cause a latency spike on the first hit (cold start). `@Lazy` beans, lazy holders (§4), and `Provider<T>` defer creation.
- **Runtime (per-call) creation** — one object per request/message/row — must be cheap and is where factories/`Supplier<T>`/`Provider<T>` belong (a *prototype-scope* bean in Spring, an unscoped binding in Guice).

The refactoring lens: when you *Move Creation Knowledge to a Factory* ([middle.md](./middle.md)), you also get to **choose the timing**. Centralizing creation makes eager-vs-lazy a one-line policy decision in one place, instead of an accident scattered across consumers.

---

## 7. Framework realities: Spring beans and Guice

In a container-based app, the framework *is* your primary factory, and the creational refactorings change shape:

- **Spring beans.** A `@Bean` method or `@Component` is a factory the container owns. Default scope is **singleton** — but a *container-managed* singleton, not the GoF Singleton: it's one instance **injected**, with no global `getInstance()`, no hidden dependency, and it's trivially swapped in tests with `@MockBean`. This is the institutionalized form of Inline Singleton — uniqueness without the pattern's costs. Other scopes (`prototype`, `request`, `session`) cover runtime creation. `@Configuration` classes are where *Move Creation Knowledge to Factory* naturally lands (see [senior.md §3](./senior.md)).
- **Guice.** Bindings (`bind(Engine.class).to(V8.class)`) are factory declarations; `Provider<T>` is the injected factory for runtime creation; `@AssistedInject` blends container-wired and call-time arguments (the textbook "factory with some args known late"). `FactoryModuleBuilder` generates assisted factories so you don't hand-write them.
- **A shared rule:** prefer **constructor injection** over field injection in both. Constructor injection makes dependencies explicit and final, keeps objects valid-on-construction, and works without the container in tests — exactly the property your creational refactorings were chasing.
- **Watch for the container as a service locator.** Injecting `ApplicationContext`/`Injector` and calling `getBean`/`getInstance` re-introduces the very hidden-dependency smell Inline Singleton removed. Inject the dependency (or a typed `Provider<T>`), never the container.

The meta-point: in a framework codebase you rarely write GoF Singletons or large bespoke factories at all — the container subsumes them. Your creational refactoring work becomes (a) replacing hand-rolled singletons/factories with container wiring, and (b) keeping the container out of your domain types via injected abstractions.

---

## 8. Next

- [junior.md](./junior.md) · [middle.md](./middle.md) · [senior.md](./senior.md)
- [interview.md](./interview.md) · [tasks.md](./tasks.md) · [find-bug.md](./find-bug.md) · [optimize.md](./optimize.md)
- Patterns: [Singleton](../../../design-patterns/01-creational/05-singleton/junior.md) · [Prototype](../../../design-patterns/01-creational/04-prototype/junior.md)
- Sibling: [05-refactoring-away-from-patterns](../05-refactoring-away-from-patterns/junior.md) (Inline Singleton in depth)
- Principle: [Dependency Inversion](../../../design-principles/04-solid/05-dip-dependency-inversion/junior.md)
