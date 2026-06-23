# Composition Over Inheritance — Senior

> **What?** The edge cases of *composition over inheritance*: when the slogan starts to lose, what frameworks force on you, how delegation interacts with `equals`/`hashCode`/`toString`, where Java's lack of multiple inheritance bites, mixins via default methods, the cost of forwarder boilerplate, and the codebases that *look* compositional but secretly still inherit.
> **How?** By treating the inheritance/composition pair as two forces — substitutability and behaviour sharing — and choosing the cheaper one *per axis of variation* in your design, not as a global stance.

---

## 1. The honest version of the slogan

Joshua Bloch's *Effective Java* item is **"Favor composition over inheritance"**, not "always use composition". Read in context, it means: when you have a *choice*, default to composition; reach for inheritance only when its specific benefits — substitutability, virtual dispatch, framework integration — are what you actually need.

Senior engineers carry both tools and pick per axis:

| You want…                                          | The cheaper tool   |
| -------------------------------------------------- | ------------------ |
| Behavioural substitutability across many call sites | Inheritance (or interface implementation) |
| Reuse of a few methods without leaking the donor's API | Composition (forwarding) |
| A closed family of variants with exhaustive dispatch | Sealed inheritance |
| Pluggable behaviour at runtime                     | Composition (Strategy) |
| Cross-cutting decoration of an interface           | Composition (Decorator chain) |
| Framework hook points (`HttpServlet`, `JpaRepository`) | Inheritance — the framework chose |
| A small piece of shared default code               | Default methods on an interface |

A reviewer who insists "no inheritance ever" is as wrong as one who reaches for `extends` first. Both miss the point: the choice is *per axis*, not per project.

---

## 2. When inheritance still wins

There are four scenarios where inheritance is the better answer, even at the senior level.

**Closed type families with exhaustive dispatch.** A `Result<T> = Success<T> | Failure` algebra benefits from sealed inheritance plus pattern matching. Composition can't express "the set of permitted subtypes is fixed at compile time".

```java
public sealed interface Result<T> permits Success, Failure {
    static <T> Result<T> of(T v)          { return new Success<>(v); }
    static <T> Result<T> fail(Throwable t) { return new Failure<>(t); }
}
public record Success<T>(T value)        implements Result<T> {}
public record Failure<T>(Throwable cause) implements Result<T> {}

// Exhaustive switch — compiler enforces every case
public static <T, U> Result<U> map(Result<T> r, Function<T, U> f) {
    return switch (r) {
        case Success<T> s -> Result.of(f.apply(s.value()));
        case Failure<T> e -> Result.fail(e.cause());
    };
}
```

**Framework contracts.** When a framework's lifecycle is expressed through inheritance (`HttpServlet.doGet`, `AbstractMessageListenerContainer`, JPA `@MappedSuperclass`), you sign that contract or you don't use the framework. Wrapping it in composition costs more than it buys.

**True behavioural substitutability.** A `Stream<T>` with `IntStream`, `LongStream`, `DoubleStream` specializations expresses a real "is-a" relationship for callers that can use the supertype. Inheritance is the natural shape.

**Performance-critical specialization.** A `final` class with a `final` method gets the JIT to devirtualize aggressively. A sealed hierarchy with three implementors still inlines cleanly. Replacing this with an interface field plus delegation adds one extra indirection — usually invisible, occasionally measurable.

The rule of thumb: if the parent was *designed* for extension (open methods, documented hook points, stable contract) and the child needs to be substitutable for the parent, inheritance is the right call. Bloch's other half: "Design and document for inheritance, or else prohibit it."

---

## 3. Delegation and the `equals`/`hashCode`/`toString` trap

The moment you compose, the wrapper's identity equations no longer derive from the wrapped object. This is where naive composition trips even experienced engineers.

```java
public final class LoggingList<T> implements List<T> {
    private final List<T> delegate;
    public LoggingList(List<T> delegate) { this.delegate = delegate; }
    // delegate everything…
}

List<String> a = new LoggingList<>(List.of("x", "y"));
List<String> b = List.of("x", "y");
a.equals(b);                  // false — Object.equals on the wrapper
new HashSet<>(List.of(a)).contains(b);   // false too
```

`LoggingList` inherits `Object.equals`, which compares references. Two `LoggingList`s wrapping equal lists are not equal. Three remedies:

- **Forward `equals`/`hashCode`/`toString` explicitly** — delegate them along with the rest of the API. Often the right answer for transparent wrappers.
- **Mark the wrapper as a distinct type** — if it has its own identity (e.g., it adds caching state that affects equality), accept the default reference equality and document it.
- **Use a record** — records auto-generate `equals`/`hashCode` from their components. A wrapper as a record automatically compares by its delegate field.

The Decorator and Adapter patterns are particularly prone to this — the wrapper *looks* equal to the wrapped object until a `HashMap` lookup tells you otherwise.

---

## 4. Forwarder boilerplate and what to do about it

Composition in Java without Lombok or records means writing forwarders by hand. A 25-method interface costs 25 one-liners.

```java
public final class TimingRepository implements OrderRepository {
    private final OrderRepository delegate;
    private final MetricsRegistry metrics;
    public TimingRepository(OrderRepository d, MetricsRegistry m) { delegate = d; metrics = m; }

    public Order load(OrderId id)          { return time("load", () -> delegate.load(id)); }
    public void save(Order o)              { time("save", () -> { delegate.save(o); return null; }); }
    public List<Order> findRecent(...)     { return time("findRecent", () -> delegate.findRecent(...)); }
    // …another 22 methods…
}
```

Senior-level options to reduce the noise without resorting to inheritance:

- **Keep the interface small.** ISP-respecting interfaces (5–8 methods, see [../01-solid-principles/](../01-solid-principles/) §5) make forwarders trivial.
- **Lombok `@Delegate`.** One annotation, all methods forwarded at compile time. Pay attention: `@Delegate` is opaque in code review and can hide surprises when the delegate's API changes.
- **IDE generation.** IntelliJ's "Delegate Methods…" command writes the boilerplate. Re-run when the interface grows.
- **Single dispatching layer.** For cross-cutting concerns (logging, tracing, metrics), wire one wrapper that knows about the metric registry and dispatches to a typed handler — instead of stacking three wrappers.
- **`InvocationHandler` proxies.** For pure forwarding-with-a-hook (auditing every method call), a `java.lang.reflect.Proxy` is one factory method. Pays for itself if the interface is big and the wrapper is generic.

The hidden cost of forwarders is *invisible API drift*: when `OrderRepository` gains a new method, every forwarder must be updated and a missed one becomes a compile error. That compile error is the *feature* — it tells you which wrappers need rethinking.

---

## 5. Multiple inheritance — composition as a feature

Java forbids multiple inheritance of classes. Composition treats this not as a limitation but as a feature: instead of inheriting from `Animal` and `Vehicle` (a category error), you have a field of each role.

```java
public interface Walks   { void walk(); }
public interface Swims   { void swim(); }
public interface Flies   { void fly();  }

public final class Duck implements Walks, Swims, Flies {
    private final Walks walker;
    private final Swims swimmer;
    private final Flies flier;
    public Duck(Walks w, Swims s, Flies f) { walker = w; swimmer = s; flier = f; }
    public void walk() { walker.walk(); }
    public void swim() { swimmer.swim(); }
    public void fly()  { flier.fly();  }
}
```

Three orthogonal capabilities, three injection points, zero diamond problem. The `Duck` *implements* all three interfaces (so callers can program to any role) but *delegates* each to a focused implementation.

Compare against a multiple-class-inheritance language: that would tie all three behaviours into one class permanently. Composition lets you swap any role at construction time — a `RubberDuck` injects a `NoopFlier`, not invents a new subclass.

---

## 6. Default methods — mixins, carefully

Java 8 added default methods on interfaces. They are mixins by another name: shared code without inheritance, but with most of inheritance's risks.

```java
public interface Resilient {
    int defaultAttempts();
    default <T> T withRetries(Supplier<T> work) {
        RuntimeException last = null;
        for (int i = 0; i < defaultAttempts(); i++) {
            try { return work.get(); } catch (RuntimeException e) { last = e; }
        }
        throw last;
    }
}
```

Any class that `implements Resilient` gets `withRetries` for free. Multiple interfaces can each contribute defaults; the compiler resolves conflicts by demanding the implementor pick one explicitly.

When defaults pay off:

- **Convenience methods over a primitive abstract method.** `Collection.stream()` is a default; every collection inherits it without subclassing.
- **Evolution of an existing interface.** Add a default with a sensible fallback so existing implementors keep compiling.
- **Trait-style composition** for small, well-defined slices of behaviour.

When defaults cause pain:

- **State.** Defaults can call methods that need state, but they can't hold any. A "trait" that wants a counter still needs a class.
- **Diamond inheritance of defaults.** Two interfaces with the same default → compile error → manual override. Workable, but a smell at scale.
- **Fragile-base problem in disguise.** A default's implementation is binding on every implementor. Changing it changes everyone — same risk as a parent class method.

Use default methods for *true* convenience layers. Reach for composition the moment a default needs state or starts driving behaviour of unrelated implementors.

---

## 7. Inheritance in framework code — what you can and can't avoid

A senior eye on `extends` in a real codebase usually finds three populations:

- **Framework-mandated `extends`.** `HttpServlet`, `RouterFunction` (Spring WebFlux), `JpaRepository<…>`, `JUnit` extensions, exception hierarchies. The framework decided; you sign or you bring your own framework.
- **Type-family `extends`.** Sealed hierarchies, ADT-shaped types, deliberate substitutability. Healthy.
- **Reuse `extends`.** A class extends another to grab a few methods — `extends BaseService`, `extends AbstractValidator`. This is the population to attack with composition.

The mid-career mistake is treating all three as the same smell. They aren't. Framework `extends` is *infrastructure*; sealed `extends` is *modeling*; reuse `extends` is *coupling*. Only the third deserves automatic refactoring.

```java
// Framework-mandated — leave alone
public final class CheckoutServlet extends HttpServlet {
    @Override protected void doPost(HttpServletRequest req, HttpServletResponse resp) { ... }
}

// Type-family — healthy
public sealed interface PaymentMethod permits Card, Bank, ApplePay { }

// Reuse — kill it
public class OrderProcessor extends BaseProcessor {       // <-- the smell
    @Override protected void process() { ... }
}
// becomes
public final class OrderProcessor {
    private final ProcessingPipeline pipeline;            // composed
    public OrderProcessor(ProcessingPipeline p) { pipeline = p; }
}
```

---

## 8. Composition's failure mode — accidental anaemia

The dual hazard of "too much composition" is the **anaemic domain model**: every class is a holder of injected collaborators, all behaviour lives in service classes, and the domain objects degrade into glorified records with getters.

```java
// Anaemic: Customer has no behaviour, all logic is elsewhere
public final class Customer {
    private final String name;
    private final List<Order> orders;
    public String getName() { return name; }
    public List<Order> getOrders() { return orders; }
}
public final class CustomerService {
    public BigDecimal totalSpent(Customer c) { return c.getOrders().stream()...; }
    public boolean isPremium(Customer c)    { return c.getOrders().size() > 10; }
}
```

Composition pushed too far gives you "objects" that are just structs and "services" that operate on them — exactly the procedural style OO was meant to replace. Inheritance critics sometimes drift here without noticing, because they conflate "composition" with "no behaviour on the data".

The corrective: behaviour belongs *near* its data when it's data-local. `Customer.totalSpent()` is a method, not a service call. Composition is about *collaborators*, not about ripping behaviour off the type that owns the data.

---

## 9. Object adapters vs class adapters

Two ways to bridge a class with a different interface:

**Class adapter (inheritance):**

```java
public final class JsonHttpResponseAdapter extends HttpResponse {
    @Override public Reader body() { return jsonReader(); }
}
```

**Object adapter (composition):**

```java
public final class JsonHttpResponseAdapter implements JsonReadable {
    private final HttpResponse delegate;
    public JsonHttpResponseAdapter(HttpResponse r) { this.delegate = r; }
    public Reader body() { return jsonReader(delegate); }
}
```

The class adapter wins on brevity *if* the adaptee is open for extension and the target type is one inheritance slot you weren't using. The object adapter wins everywhere else:

- It works when the adaptee is `final` or sealed-and-not-permitted.
- It works when the target type is itself a class (you can't `extends` two things).
- It lets the wrapper hold extra state, override behaviour, or compose multiple adaptees.
- It survives the adaptee changing its public surface — your wrapper exposes only what it forwards.

Senior code reviews lean object adapter by default. Class adapter is acceptable only when the adaptee's design *invited* extension and the wrapper has no extra state.

---

## 10. Composition cost — the indirection chain

Every layer of composition adds one method call. In ordinary code this is invisible; in tight loops it is measurable.

```java
public final class RetryingGateway implements PaymentGateway {       // layer 3
    private final PaymentGateway delegate;
    public Receipt charge(PaymentRequest r) {
        for (int i = 0; i < 3; i++) {
            try { return delegate.charge(r); } catch (TransientException e) {}
        }
        throw new GatewayException("retries exhausted");
    }
}
public final class IdempotentGateway implements PaymentGateway {     // layer 2
    private final PaymentGateway delegate;
    public Receipt charge(PaymentRequest r) {
        return cache.computeIfAbsent(r.idempotencyKey(), k -> delegate.charge(r));
    }
}
public final class StripeGateway implements PaymentGateway {         // layer 1
    public Receipt charge(PaymentRequest r) { /* HTTP */ }
}
PaymentGateway full = new RetryingGateway(new IdempotentGateway(new StripeGateway()));
```

Three layers, three method calls, three potential vtable / itable hits. The JIT's job is to *prove* the call site sees only one concrete type for each layer and to inline through all three. Two conditions help that:

- **Wire once, hold the chain in a `final` field.** The composition root assembles the chain at startup; nothing rewrites it.
- **Same type profile everywhere.** Don't reconfigure the chain per request, per thread, per anything. Identical profiles let the JIT collapse the whole tower.

When those conditions hold, three composition layers cost roughly one direct call. When they fail (per-request reconfiguration, megamorphic call sites), the cost grows linearly with depth. See [`optimize.md`](optimize.md) for the JMH numbers.

---

## 11. Anti-patterns and "fake composition"

Codebases that claim *composition over inheritance* but break the spirit:

- **The wrapper that forwards everything plus throws on one method.** "Inheritance is bad" was internalized as "use composition", but the wrapper still violates LSP — it just sneaks past compile-time checks. See [`find-bug.md`](find-bug.md) Bug 1.
- **The chain that nobody can read.** Six decorators deep around one repository. The intent of the code is now distributed across six files, each one a one-line forward plus a snippet of cross-cutting logic. Composition was right; six layers was wrong.
- **The "composition" that's actually a stateful singleton.** A class holds a static field of "the strategy" and changes it at runtime. That's not composition; that's a global with extra steps.
- **The anaemic domain.** Data classes plus service classes plus no behaviour anywhere data lives. Composition strangled the model. (§8.)
- **The forwarder that drifts.** A wrapper that was generated when the interface had 12 methods and now has 14. The two new methods silently fall through to `Object`'s defaults or throw `AbstractMethodError`. Without an `@Override` on every forwarder, you don't get the compile error.

The honest test: would removing the wrapper change observable behaviour? If no, it's structural debt, not composition.

---

## 12. Quick rules

- Inheritance: for substitutability, closed families, framework hooks.
- Composition: for behaviour sharing, cross-cutting concerns, swappable strategies.
- One axis at a time — don't mix substitutability and reuse on the same `extends`.
- Forwarders deserve `@Override` and a test that breaks when the interface grows.
- Records make wrappers' `equals`/`hashCode`/`toString` trivial — use them.
- Default methods are mixins; treat their changes as breaking changes for implementors.
- Object adapter > class adapter by default; the class adapter is a special case.
- Don't compose so far that behaviour disappears from the data class.
- Wire decorator chains once at the composition root; the JIT rewards stability.
- "Fake composition" is wrappers that throw, chains that nobody reads, and forwarders that drift.

---

## 13. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving the rule across a team, code-review vocabulary      | `professional.md`  |
| Where final/sealed/interface/default rules live in JLS      | `specification.md` |
| Spotting silent inheritance abuse                           | `find-bug.md`      |
| JIT, dispatch, allocation: composition vs inheritance       | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** composition over inheritance is a *default*, not a *dogma*. Inheritance buys substitutability and exhaustive dispatch; composition buys reuse without coupling. Choose per axis of variation. Forwarders are the price; records, IDEs, and `@Override` keep the price low. The senior-level failure mode isn't too much inheritance — it's too much composition, draining behaviour from the domain into a soup of services.
