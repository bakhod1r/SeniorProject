# Final Keyword — Senior

> **How to optimize?** `final` is an architectural commitment expressed in one keyword. Apply it to lock in invariants, enable JIT inlining, support safe publication, and signal "this is part of the contract." The wins compound — fewer bugs, faster code, simpler tests.
> **How to architect?** Decide for each class: is it a value (final + immutable), an entity (selective immutability), a service (immutable dependencies), or an extension point (sealed + final hierarchy)? Each has a different `final` profile.

---

## 1. `final` as architectural commitment

Every `final` is a *promise to the future*:

- `final class Money` → "I will never let anyone subclass this; refactor freely."
- `final long balance` → "this field never changes after construction; safe to share."
- `final void close()` → "the close protocol is mine; subclasses cannot redirect it."

Removing `final` later is *easy* — no caller breaks. Adding `final` later is *hard* — if any code depended on the missing `final`, it now fails to compile. So **add `final` early; remove only with cause**.

---

## 2. The four archetypes and their `final` profiles

| Archetype | `final` class | `final` fields | `final` methods |
|-----------|--------------|----------------|-----------------|
| **Value object** | Yes | Yes (all) | N/A (class is final) |
| **Entity / aggregate** | Often no (DI proxies); use `sealed` if possible | Mixed: identity is `final`; mutable state is non-`final` | Yes for orchestration; `protected` hooks for variation |
| **Service** | Yes (or interface + final impl) | Yes (all dependencies) | N/A |
| **Extension base class** | No (must allow subclasses) | Yes (state); access via `protected final` accessors | Yes for non-overridable methods |

Mixing archetypes is where confusion arises. A "value object" with mutable state is a contradiction; an "entity" without final identity loses tracking; a "service" with mutable dependencies is a singleton-shaped global.

---

## 3. Value objects: lock everything

A value type:

```java
public final class Money {
    private final long cents;
    private final Currency currency;

    public Money(long cents, Currency currency) { ... }

    public Money plus(Money other) { return new Money(...); }   // returns new instance
}
```

Or as a record:

```java
public record Money(long cents, Currency currency) {
    public Money plus(Money other) { return new Money(...); }
}
```

Records make the value-object pattern *the default*: implicitly `final`, components implicitly `private final`. For new value types, prefer records.

Architectural rule: **values are equal by content, not by identity. Subclassing breaks this. Hence `final` class.**

---

## 4. Entities: identity is `final`, state is not

```java
public class Order {
    private final OrderId id;             // identity — never changes
    private final Instant createdAt;       // creation timestamp — never changes
    private OrderStatus status;            // changes during lifecycle
    private final List<OrderLine> lines;   // reference is final; collection is mutable

    public Order(OrderId id) {
        this.id = id;
        this.createdAt = Instant.now();
        this.status = OrderStatus.DRAFT;
        this.lines = new ArrayList<>();
    }

    @Override public boolean equals(Object o) {
        return o instanceof Order other && id.equals(other.id);
    }
}
```

The `final` distinction:

- `id`, `createdAt` → `final`. They define the entity; they're set once.
- `status`, `lines` (the list itself) → mutable, but `lines` reference is `final` (you don't replace the list, you mutate its contents).

This is the typical entity shape. Often the class is *not* `final` because DI containers (Spring, Hibernate) generate runtime proxies. Use `sealed` if you control all subclasses.

---

## 5. Services: immutable wiring

```java
public final class OrderService {
    private final OrderRepository repository;
    private final EmailSender sender;
    private final Clock clock;

    public OrderService(OrderRepository repository, EmailSender sender, Clock clock) {
        this.repository = repository;
        this.sender = sender;
        this.clock = clock;
    }

    public Order place(OrderRequest req) { ... }
}
```

Every dependency is `final`. The class is `final`. Once constructed, the service is fully wired and stateless (all "state" lives in its dependencies).

This is the canonical service shape. It plays beautifully with DI — the container constructs once, the service runs for the lifetime of the application.

If you must allow subclassing for testing or proxies, use an interface:

```java
public interface OrderService { ... }
public final class DefaultOrderService implements OrderService { ... }
```

---

## 6. Extension base classes: `final` selectively

```java
public abstract class HttpServlet {                          // not final — must be extended
    public final void service(...) {                         // final — protocol is fixed
        if (req.method().equals("GET")) doGet(req, res);
        else if (req.method().equals("POST")) doPost(req, res);
        else doDefault(req, res);
    }

    protected void doGet(...) { /* default 404 */ }           // not final — subclass overrides
    protected void doPost(...) { /* default 404 */ }
    protected final void doDefault(...) { /* fixed */ }       // final — fallback locked
}
```

The pattern:

- Class itself: not `final` (must be extended).
- Public template method (`service`): `final` — the orchestration is fixed.
- Hooks for subclasses (`doGet`, `doPost`): not `final` — that's the extension point.
- Fixed behavior (`doDefault`): `final`.

This is the **template method pattern** done right. The base class controls the protocol; subclasses customize specific steps.

---

## 7. `final` and the JIT — small but real

Marking a method or class `final` lets the JIT skip CHA dependency tracking:

- A `final` method's call site can be inlined directly. No "if a new subclass loads, recompile" hook.
- A `final` class's instance methods are similarly inline-friendly.

The wins per call:

- Monomorphic non-`final` method: inlined via CHA. ~1 ns more compile time, equal runtime.
- `final` method: inlined directly. Equal runtime.
- Megamorphic non-`final` method: vtable lookup. ~3 ns/call.

So `final` doesn't *speed up* monomorphic code; it *prevents future deoptimization* if your monomorphic class accidentally becomes polymorphic. Cheap insurance.

---

## 8. `final` and concurrency

The JLS §17.5 freeze rule: `final` fields, set in a constructor that doesn't leak `this`, are guaranteed visible to other threads after the constructor returns — without explicit synchronization.

Practical consequence: an immutable object with all-`final` fields is **safe to publish via any mechanism**. Plain field write, hand-off through a queue, return value — all of these expose a fully-constructed view to readers.

For non-`final` fields, the same publication might expose default values (zero, null, false). Without `volatile`, `synchronized`, or final-field semantics, the JMM doesn't guarantee visibility.

So: making fields `final` is the cheapest, most ergonomic, most idiomatic way to enable thread-safe sharing. The alternatives (volatile fields, synchronized blocks, atomic references) cost more in code, complexity, and runtime.

---

## 9. The "frozen at the boundary" pattern

In domain-driven design, aggregates often look like:

```java
public class Order {
    public Order ship() {
        if (status != PLACED) throw new IllegalStateException();
        var shipped = new Order(id, lines, SHIPPED, ...);   // new instance with new state
        return shipped;
    }
}
```

Each transition produces a new immutable `Order`. The previous instance is unchanged. Concurrency-safety is automatic.

Trade-off: more allocation per state change. Mitigation: object pools (rarely worthwhile), structural sharing (hard in Java without persistent collections), or using *mutable* aggregates with controlled lifecycle (most common).

For high-throughput services, the immutable-aggregates approach is often slower per request but scales linearly with cores (no synchronization needed). Pick based on workload.

---

## 10. Records and `final` — the modern shape

Records (Java 16+) bake the value-object pattern into the language:

```java
public record Order(OrderId id, List<OrderLine> lines, OrderStatus status) {
    public Order {
        Objects.requireNonNull(id);
        lines = List.copyOf(lines);            // defensive copy in compact constructor
    }

    public Order ship() {
        if (status != PLACED) throw new IllegalStateException();
        return new Order(id, lines, SHIPPED);
    }
}
```

Properties:

- Class is `final`.
- All component fields are `private final`.
- Auto-generated `equals`/`hashCode`/`toString`.
- Compact constructor allows validation/normalization.

For new code, *records are the default* for any type representing a value. Manual `final class` + `final` fields is for cases where you need:

- A non-final class (rare — usually a sign you're modeling an entity, not a value).
- Hidden representation (record components are `private final` and exposed via accessors — most cases want exactly this).
- A no-arg constructor for legacy framework compatibility.

---

## 11. `final` and reflection

Reflection can bypass `final` — *technically*. Historically:

```java
Field f = MyClass.class.getDeclaredField("CONSTANT");
f.setAccessible(true);
f.setInt(null, 999);                  // mutates a final field
```

Java 9+ tightened this: `final` static fields cannot be reassigned via reflection in modular code without `--add-opens` or proper `opens` declarations. Java 17+ flags such operations as warnings.

Plus: even when reflection succeeds, the JIT may have inlined the constant value — readers may continue to see the old value. Effectively: **don't rely on mutating `final` fields via reflection**. It's undefined behavior in modern Java.

---

## 12. Refactoring toward `final`

A typical refactor sequence:

1. **Identify mutable state.** Scan for non-`final` fields. Most should be `final`.
2. **Make them `final`.** Run the build. If a setter or post-construction assignment breaks, decide: is the mutability necessary?
3. **For unnecessary mutability**: remove the setter, force assignment in constructor.
4. **For necessary mutability**: leave non-`final`; document why.
5. **Make leaf classes `final`.** Run the build again. Subclass usages reveal themselves.
6. **For unnecessary subclasses**: refactor to composition.
7. **For necessary subclasses**: keep non-`final`; consider `sealed`.

The diff is usually small. The reward: cleaner code, fewer bugs, easier refactoring.

---

## 13. The cost of *not* using `final`

A non-`final` field is a permanent commitment:

- Anyone can write to it (subject to access modifiers).
- Concurrent access requires explicit thread-safety story.
- Refactoring into a computed property requires a setter that throws / a deprecation cycle.
- Reasoning about state requires checking every assignment.

A non-`final` class is a permanent commitment:

- Subclasses may exist anywhere.
- Liskov substitution must hold for every method.
- Every internal call is potentially polymorphic — refactoring may break subclasses.
- Adding a new method may conflict with a subclass's method.

These costs accumulate. Codebases that embrace `final` aggressively report fewer bugs, smaller PRs, and faster development.

---

## 14. `final` is not a panacea

`final` doesn't fix:

- **Hidden mutability inside collections** — use `List.of`, `Map.copyOf`.
- **Hidden mutability inside referenced objects** — use immutable types.
- **Concurrency bugs in compound operations** — `final` fields don't make `++` atomic.
- **Bad design** — a poorly-designed final class is still a poorly-designed class.

Treat `final` as one tool among many. Combined with immutable types, defensive copies, records, and good architecture, it's powerful. Alone, it's just a keyword.

---

## 15. The senior checklist

For each new class:

1. **Archetype?** Value, entity, service, extension point.
2. **`final` class?** Yes for values and services; sealed/non-final for entities and extension points.
3. **`final` fields?** All except deliberate mutable state.
4. **`final` methods?** For non-overridable orchestration; redundant if class is final.
5. **Records or hand-rolled?** Records when components fit; hand-rolled when you need flexibility.
6. **Immutability?** `final` field + immutable type (or defensive copy).
7. **Concurrency?** Final fields enable safe publication; non-final fields need explicit story.
8. **JIT?** Final classes/methods inline without CHA.
9. **Reflection?** Don't rely on bypassing `final`; design the API not to need it.

Senior `final` discipline is *automatic*: you reach for `final` first and remove it only with cause. The result is code that's easier to read, easier to refactor, easier to thread, and easier to optimize.
