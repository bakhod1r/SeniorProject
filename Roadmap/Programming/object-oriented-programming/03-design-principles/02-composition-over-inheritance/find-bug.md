# Composition Over Inheritance — Find the Bug

> 10 buggy snippets where `extends` is doing the work composition should have done. For each: read the code, decide which axis of inheritance abuse it shows (leaked API, broken substitutability, fragile base, identity confusion, hidden lifecycle), pinpoint the runtime symptom, and write the fix.

---

## Bug 1 — `CountingList extends ArrayList`

```java
public final class CountingList<E> extends ArrayList<E> {
    private int addCount = 0;

    @Override public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }

    public int addCount() { return addCount; }
}
```

```java
CountingList<String> list = new CountingList<>();
list.addAll(List.of("a", "b", "c"));
System.out.println(list.addCount());      // 6, not 3
```

**Symptom.** The counter is double-counting. Every `addAll(c)` call triggers `addCount += c.size()` (line `+= c.size()`), and *also* — inside `ArrayList.addAll` — calls `add(e)` for each element, which increments by one each time.

**Violation.** Inheritance leaked the parent's *implementation*, not just its API. `ArrayList.addAll` calls `add` internally; the subclass override fires twice per element. This is Bloch's canonical "self-use" example: a parent's internal invariants are now part of your override contract.

**Fix.** Compose, don't extend.

```java
public final class CountingList<E> {
    private final ArrayList<E> backing = new ArrayList<>();
    private int addCount = 0;

    public boolean add(E e)                 { addCount++; return backing.add(e); }
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size(); return backing.addAll(c);
    }
    public int addCount() { return addCount; }
}
```

No more inheritance, no more self-use trap. The counter increments exactly where you wrote the line.

---

## Bug 2 — Subclass forgets to call `super`

```java
public class CacheableRepository<T> {
    public void clear() { clearCache(); clearStorage(); }
    protected void clearCache()   { /* ... */ }
    protected void clearStorage() { /* ... */ }
}

public class IndexedRepository<T> extends CacheableRepository<T> {
    @Override public void clear() {
        clearIndex();
        // forgot super.clear()
    }
    private void clearIndex() { /* ... */ }
}
```

```java
IndexedRepository<Order> repo = ...;
repo.clear();
// cache and storage are NOT cleared. Index is.
// Stale records remain. Reads return old data.
```

**Symptom.** After `clear()`, the cache and storage still hold data. Reads come back stale. The bug surfaces only when someone audits cache contents — possibly weeks later.

**Violation.** Inheritance gave the subclass the *option* to call `super.clear()`, and the option was not exercised. The parent's contract ("clear() empties everything") is now silently broken in the child. LSP violation through omission.

**Fix.** Composition forces the call to be explicit — there is no "implicit super" to forget.

```java
public final class IndexedRepository<T> {
    private final CacheableRepository<T> base;
    public IndexedRepository(CacheableRepository<T> base) { this.base = base; }

    public void clear() {
        clearIndex();
        base.clear();        // call site is visible; tests catch its absence
    }
    private void clearIndex() { /* ... */ }
}
```

---

## Bug 3 — Two parents, can't have both

```java
public class TimingMixin {
    public long startedAt() { return System.nanoTime(); }
}

public class AuditingMixin {
    public void logAccess() { /* ... */ }
}

public class CustomerRepository extends ??? {   // can only extend one
    // wants both TimingMixin and AuditingMixin
}
```

**Symptom.** Java compiles class declarations with one `extends` slot. The developer faces a choice: arbitrarily pick one parent as the "primary" and re-implement the other, or invent an intermediate base class `AuditingTimingMixin` that combines both. Both paths rot:

```java
public class AuditingTimingMixin extends TimingMixin {
    public void logAccess() { /* duplicated from AuditingMixin */ }
}
```

Six months later, `AuditingMixin.logAccess()` changes. `AuditingTimingMixin.logAccess()` doesn't. Audits diverge across the codebase.

**Violation.** Single-inheritance forced a false hierarchy. The two "mixins" have nothing to do with each other and should not have shared a parent slot.

**Fix.** Composition — hold one of each.

```java
public final class CustomerRepository {
    private final Timing timing;
    private final Auditor auditor;

    public CustomerRepository(Timing t, Auditor a) {
        this.timing = t;
        this.auditor = a;
    }
}
```

Two orthogonal capabilities, two fields, zero forced hierarchy. Both stay updated independently because there is no copy.

---

## Bug 4 — `equals` lies after composition

```java
public final class TracedRepository implements OrderRepository {
    private final OrderRepository delegate;
    private final Tracer tracer;

    public TracedRepository(OrderRepository d, Tracer t) {
        this.delegate = d;
        this.tracer = t;
    }
    @Override public Order load(OrderId id) { /* delegate + tracing */ }
    @Override public void save(Order o)     { /* delegate + tracing */ }
    // no override of equals/hashCode
}
```

```java
OrderRepository a = new TracedRepository(jdbc, tracer);
OrderRepository b = new TracedRepository(jdbc, tracer);
a.equals(b);                            // false — Object.equals: reference identity
Set<OrderRepository> s = new HashSet<>(List.of(a));
s.contains(b);                          // false too
```

**Symptom.** A `Map<OrderRepository, Stats>` keyed on repository instances ends up with duplicate keys after a reconfiguration. The "same" repository now hashes to a different bucket.

**Violation.** Composition without thinking about identity. The wrapper inherits `Object.equals` (reference identity) and silently breaks any caller that treats the type as a value.

**Fix.** Pick one explicitly:

- **Forward `equals`/`hashCode`** if the wrapper is a *transparent* decoration that should be equal to its delegate.
- **Document reference identity** if the wrapper has its own state that affects equality.
- **Use a record** to get value semantics automatically:

```java
public record TracedRepository(OrderRepository delegate, Tracer tracer) implements OrderRepository {
    public Order load(OrderId id) { /* ... */ }
    public void save(Order o)     { /* ... */ }
    // equals/hashCode/toString generated from components
}
```

---

## Bug 5 — Hierarchical lifecycle, partial initialization

```java
public abstract class HealthCheckedService {
    private final HealthCheck check;
    protected HealthCheckedService() {
        this.check = createHealthCheck();    // virtual call in constructor
        HealthRegistry.register(check);
    }
    protected abstract HealthCheck createHealthCheck();
}

public final class PaymentService extends HealthCheckedService {
    private final URL endpoint;

    public PaymentService(URL endpoint) {
        super();
        this.endpoint = endpoint;
    }

    @Override
    protected HealthCheck createHealthCheck() {
        return () -> ping(endpoint);          // (*) NPE: endpoint not yet assigned
    }
}
```

**Symptom.**

```
Exception in thread "main" java.lang.NullPointerException
    at com.acme.PaymentService.ping(PaymentService.java:34)
    at com.acme.PaymentService$$Lambda.run(...)
    at com.acme.HealthCheckedService.<init>(HealthCheckedService.java:6)
```

The `super()` call dispatches `createHealthCheck()` *before* `this.endpoint = endpoint` runs. Java's instance initialization order (JLS §12.5) is: superclass constructor first, then subclass fields and constructor body.

**Violation.** Inheritance forced an early lifecycle decision. The parent decided when to call the polymorphic hook; the child had no chance to be ready.

**Fix.** Composition lets each piece initialize in its own order.

```java
public final class PaymentService {
    private final URL endpoint;
    private final HealthCheck check;

    public PaymentService(URL endpoint, HealthRegistry registry) {
        this.endpoint = endpoint;
        this.check = () -> ping(endpoint);   // now `endpoint` is assigned
        registry.register(check);
    }
}
```

The two-phase init (assign all fields, *then* register externally) replaces the parent's hidden virtual call.

---

## Bug 6 — Decorator chain reordering changes semantics

```java
PaymentGateway g1 = new RetryingGateway(
                       new IdempotentGateway(
                           new StripeGateway()));   // intent A

PaymentGateway g2 = new IdempotentGateway(
                       new RetryingGateway(
                           new StripeGateway()));   // intent B
```

**Symptom.** Both chains compile. Both look correct in review. Production behaviour differs:

- `g1`: *retry → idempotency → stripe*. Each retry attempt is independent. If the first succeeds at Stripe but the response is lost, the retry sees no idempotency record (we haven't even checked the cache) and double-charges.
- `g2`: *idempotency → retry → stripe*. The idempotency cache wraps the retry loop. The first successful call is cached; retries return the cached receipt without hitting Stripe again. Correct.

**Violation.** Composition is right, but *ordering of layers* is now part of the contract — and the contract is implicit. Nothing prevents a refactor from swapping the order.

**Fix.** Make the order explicit and tested.

```java
@Configuration
class GatewayCompositionRoot {
    @Bean PaymentGateway paymentGateway(DataSource ds) {
        // ORDER MATTERS: idempotency MUST wrap retry, see ADR-014
        return new IdempotentGateway(
                   new RetryingGateway(
                       new StripeGateway(ds)));
    }
}
```

Then add an integration test that exercises the chain end-to-end, verifying that a transient failure followed by a retry does *not* produce a duplicate charge. The test pins the contract; a future reordering breaks the test, not production.

---

## Bug 7 — Subclass strengthens preconditions

```java
public class Queue<T> {
    /** Enqueue any non-null item. */
    public void enqueue(T item) {
        Objects.requireNonNull(item);
        store(item);
    }
    protected void store(T item) { /* ... */ }
}

public final class TaggedQueue<T> extends Queue<T> {
    @Override
    public void enqueue(T item) {
        Objects.requireNonNull(item);
        if (!(item instanceof Tagged)) {
            throw new IllegalArgumentException("requires Tagged");
        }
        store(item);
    }
}
```

```java
// Caller, holding a parent reference:
Queue<Object> q = pickQueue();        // sometimes a TaggedQueue
q.enqueue(new PlainObject());         // legal for Queue, throws for TaggedQueue
```

**Symptom.** A scheduled job that enqueues plain `Object`s into "whatever queue is configured" works for months. The day someone wires a `TaggedQueue` into the same slot, the job starts throwing `IllegalArgumentException`. The caller wasn't written to handle that.

**Violation.** LSP precondition strengthening — see [../01-solid-principles/](../01-solid-principles/) §L. Inheritance promised substitutability; the override revoked it.

**Fix.** `TaggedQueue` is not a kind of `Queue<T>`. Express it as its own type.

```java
public final class TaggedQueue {
    private final Queue<Tagged> backing = new Queue<>();
    public void enqueue(Tagged item) { backing.enqueue(item); }
}
```

A caller that wants tagging asks for a `TaggedQueue`; a caller that wants any queue gets a `Queue<T>`. The two types do not pretend to be the same.

---

## Bug 8 — `getClass()` checks fail for the wrapper

```java
public abstract class Animal {
    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Animal a = (Animal) o;
        return Objects.equals(name(), a.name());
    }
    public abstract String name();
}

public final class Dog extends Animal {
    private final String name;
    public Dog(String n) { name = n; }
    public String name() { return name; }
}

public final class TrackedDog extends Dog {
    private final Tracker tracker;
    public TrackedDog(String n, Tracker t) { super(n); tracker = t; }
}
```

```java
Dog plain   = new Dog("Rex");
Dog tracked = new TrackedDog("Rex", tracker);
plain.equals(tracked);     // false — different getClass()
```

**Symptom.** A `Map<Dog, Vaccination>` lookups fail intermittently. The map was keyed by a `Dog`, and a downstream layer accidentally re-keyed with a `TrackedDog` of the same name. The map says no match.

**Violation.** Inheritance plus `getClass()`-based `equals` (§3.5 of *Effective Java* item 10): subclasses can't preserve the equality contract. The "subclass" is really a wrapping — composition would have made the inheritance invisible to equality.

**Fix.** Compose. `TrackedDog` holds a `Dog`, equality is the dog's equality.

```java
public final class TrackedDog {
    private final Dog dog;
    private final Tracker tracker;
    public TrackedDog(Dog d, Tracker t) { dog = d; tracker = t; }
    public Dog dog() { return dog; }
    // tracker is its own concern; equality compares dogs through `dog`
    @Override public boolean equals(Object o) {
        return o instanceof TrackedDog td && dog.equals(td.dog);
    }
    @Override public int hashCode() { return dog.hashCode(); }
}
```

The map keys can be either `Dog` or `TrackedDog` and lookups behave consistently.

---

## Bug 9 — Spring `@Transactional` on inherited methods

```java
public abstract class BaseService {
    @Transactional
    public void save(Object entity) {
        repository().save(entity);
    }
    protected abstract Repository repository();
}

public class OrderService extends BaseService {
    @Override protected Repository repository() { return orderRepo; }

    public void process(Order o) {
        validate(o);
        save(o);                  // (*) intra-class call — bypasses proxy
    }
}
```

**Symptom.** Two orders saved through `process()` are persisted but partial. The transaction never started. The audit log shows commits without rollbacks; the partial-write is permanent.

**Violation.** Spring's `@Transactional` is proxy-based: it intercepts calls *from outside* the bean. The intra-class call `save(o)` (line `*`) bypasses the proxy because the method invocation goes through `this`, not the proxy reference. Inheritance hid this from review — `save` looked like a transactional boundary, but it isn't when called from inside `OrderService`.

**Fix.** Compose. The transactional method lives on a separate, injected component:

```java
public final class OrderService {
    private final TransactionalOrderSaver saver;
    public OrderService(TransactionalOrderSaver saver) { this.saver = saver; }
    public void process(Order o) {
        validate(o);
        saver.save(o);            // call through a separate bean → goes through proxy
    }
}

@Component
final class TransactionalOrderSaver {
    private final OrderRepository repo;
    public TransactionalOrderSaver(OrderRepository repo) { this.repo = repo; }
    @Transactional
    public void save(Order o) { repo.save(o); }
}
```

The transactional boundary is now a *component boundary*, which is exactly what Spring's proxy mechanism intercepts. No inheritance, no hidden bypass.

---

## Bug 10 — Diamond default-methods

```java
public interface Loggable {
    default void log(String s) { System.out.println("[LOG] " + s); }
}

public interface Metered {
    default void log(String s) { Metrics.counter("metered.log").inc(); }   // sneaky reuse
}

public class CheckoutHandler implements Loggable, Metered {
    public void handle(Order o) {
        log("processing " + o.id());
        // ...
    }
}
```

**Symptom.** Compile error:

```
class CheckoutHandler inherits unrelated defaults for log(String) from types Loggable and Metered
```

A junior who doesn't recognise the message adds:

```java
@Override public void log(String s) { Loggable.super.log(s); }
```

Now metrics never increment. Or the opposite:

```java
@Override public void log(String s) { Metered.super.log(s); }
```

Now nothing is printed. The fix is "either-or", and silently dropping half is invisible to review.

**Violation.** Default methods are mixins with no state, but they collide on signatures. Two unrelated interfaces both decided `log(String)` was theirs.

**Fix.** Composition of the *logging concern* as a real object, not as an inherited default.

```java
public interface Loggable { default Logger logger() { return Logger.NOOP; } }
public interface Metered  { default Meter  meter()  { return Meter.NOOP; } }

public final class CheckoutHandler implements Loggable, Metered {
    private final Logger logger;
    private final Meter  meter;
    public CheckoutHandler(Logger l, Meter m) { logger = l; meter = m; }
    public Logger logger() { return logger; }
    public Meter  meter()  { return meter; }

    public void handle(Order o) {
        logger().info("processing " + o.id());
        meter().count("checkout.handled");
    }
}
```

The two interfaces now contribute *role accessors*, not behaviour. The behaviour lives in injected collaborators; no signature collisions, no silent half-functioning fallbacks.

---

## Pattern summary

| Bug | Inheritance smell                                  | Composition fix                                  |
|-----|----------------------------------------------------|--------------------------------------------------|
| 1   | Self-use of parent methods double-counts in overrides | Wrap with a `final` field; forward explicitly  |
| 2   | Subclass forgets `super` call                      | Composition makes the call site explicit         |
| 3   | Single-inheritance forces a false parent           | Inject two fields, one per role                  |
| 4   | Wrapper's `equals` falls back to reference identity | Record wrapper, or explicit `equals` forwarding |
| 5   | Virtual call in constructor sees uninitialized field | Two-phase init through composition             |
| 6   | Decorator order is part of the contract            | Make the order explicit at the composition root  |
| 7   | Subclass strengthens preconditions (LSP)           | Don't extend; declare its own type               |
| 8   | `getClass()` equality breaks substitutability       | Wrapper holds the original; equality forwards   |
| 9   | Spring proxy bypassed by intra-class inheritance call | Move `@Transactional` to a separate bean      |
| 10  | Default-method diamond resolves silently           | Inject the behaviour as a field, not a default   |

These violations rarely produce a clean compile error. They show up as double-counted metrics, partial commits, silent dropped behaviour, equality misses, and lifecycle NPEs — symptoms a careful reviewer learns to associate with `extends` doing more than it should.
