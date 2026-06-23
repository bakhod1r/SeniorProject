# Immutability and Defensive Copying — Interview Q&A

20 questions covering the five rules, defensive copying, records, final-field semantics, the JDK's immutable collection helpers, thread-safety, and where the language is heading.

---

## Q1. What makes a class immutable in Java? List the rules.

A class is immutable when its observable state cannot change after construction. Joshua Bloch's *Effective Java* item 17 ("Minimize mutability") gives the five rules: (1) no setters — no method that modifies the object's state; (2) the class is `final` so a subclass can't add a setter or override a getter to lie; (3) every field is `final`; (4) every field is `private` so it cannot be reassigned by outside code; (5) any mutable component (a `List`, a `Date`, an `int[]`) is defensively copied at the boundary — once in the constructor, once in any getter that returns it.

**Follow-up:** "Which rule does a record automate?" Rules 1-4. Rule 5 is your responsibility, in the compact constructor.

---

## Q2. Why is immutability valuable enough to be the default?

Three concrete reasons. **One:** thread-safety. An immutable object can be shared across threads without `volatile`, `synchronized`, or `Atomic*` — there is no race because there is no state to race over. **Two:** stable identity in hash structures. A `Map<Customer, Address>` only works if `Customer.hashCode()` is stable; mutate a hashed field on a key and the entry becomes unreachable. **Three:** local reasoning. When `order.total()` returns a value, you know nothing else can secretly change it. You don't have to trace setters, listeners, or reflection. Immutable code is easier to read, easier to test, and easier to debug.

**Trap:** answering with "performance" — immutability is *sometimes* faster (lock-free reads) and *sometimes* slower (copy on modification). The wins are correctness and clarity.

---

## Q3. What is defensive copying and where do you do it?

Defensive copying snapshots a mutable component at the boundary of the class — on the way in (constructor parameter) and on the way out (getter return value). The goal is to make sure no external caller can mutate the class's internal state by holding a reference to the same object. The constructor copy prevents the caller's reference from sharing storage with the class; the getter copy prevents callers who receive the value from mutating the class's storage.

```java
public Reservation(Date checkIn) {
    this.checkIn = new Date(checkIn.getTime());      // copy IN
}
public Date checkIn() {
    return new Date(checkIn.getTime());              // copy OUT
}
```

**Trap:** copying immutable types like `String` or `Instant`. There's no need; the JDK already guarantees they cannot be mutated.

---

## Q4. Does a record automatically defensively copy its components?

No. A record automates rules 1-4 of Bloch's recipe — it's `final`, the fields are `private final`, there are no setters, the canonical constructor and accessors are generated. But rule 5 — defensive copying of mutable components — is *not* automated. A `record Cart(List<Item> items) {}` stores the caller's exact list reference; mutating that list mutates the cart.

The cure is the compact constructor:

```java
public record Cart(List<Item> items) {
    public Cart {
        items = List.copyOf(items);
    }
}
```

The compact constructor body runs before the implicit field assignment, so reassigning `items` to a copy snapshots the caller's list.

**Follow-up:** "Why doesn't the language do this automatically?" Because the compiler can't tell whether a type is mutable, and "snapshot the caller's reference" might not be what the author wants (e.g., for shared service references).

---

## Q5. What is the difference between `List.copyOf` and `Collections.unmodifiableList`?

`List.copyOf(L)` returns an *immutable snapshot* of the input — a new list with its own elements. Subsequent mutations to the source are not visible. It also rejects `null` elements.

`Collections.unmodifiableList(L)` returns an *unmodifiable view* over the source — the wrapper refuses to add/remove, but the source can still be mutated by anyone who holds it, and the changes are visible through the wrapper. It accepts `null` elements.

```java
List<String> source = new ArrayList<>(List.of("a"));

List<String> wrap = Collections.unmodifiableList(source);
List<String> snap = List.copyOf(source);

source.add("b");
wrap.size();    // 2 — view sees the mutation
snap.size();    // 1 — independent snapshot
```

For implementing immutability, use `List.copyOf`. It's shorter, snapshots properly, and short-circuits when the input is already immutable.

---

## Q6. Explain the JLS §17.5 final-field guarantee.

JLS §17.5 says: an object's `final` fields, set during construction, are guaranteed to be visible to any thread that observes the constructed reference — *without* synchronization. The JVM inserts a store-store barrier at the end of every constructor that writes a `final` field. The guarantee applies only if `this` does not escape the constructor (no listener registration, no thread start, no static-field store before the constructor returns).

This is what makes immutable objects the foundation of lock-free programming in Java. You can publish an immutable object through a non-volatile field and still get correct content visibility — though for *reference* visibility you still need a happens-before edge (`AtomicReference`, `volatile`, `synchronized`).

**Trap:** assuming `final` gives reference visibility too. It doesn't — `final` only protects field contents. Use `AtomicReference` or `volatile` for the holder.

---

## Q7. What is "effective immutability" and when do you need it?

A class is *effectively immutable* if it never mutates after publication, even though it isn't declared with `final` fields. The state is set during initialisation, then the reference is published through a safe channel (`volatile` write, `Atomic*.set`, `synchronized` block, `Thread.start`), and no thread mutates the object thereafter. JPA entities, Jackson-bound DTOs with default constructors, and pre-record value classes are typical examples.

Effective immutability is a *runtime* property; the type system doesn't enforce it. One careless caller mutates the object and you have a data race. True immutability via `final` + records keeps the compiler honest. Effective immutability is a fallback for frameworks that can't be the enforcer.

**Follow-up:** "When isn't effective immutability enough?" Anywhere you can't audit every call site — public APIs, library code, code that the framework constructs reflectively.

---

## Q8. Why is `BigDecimal.equals` a trap, and how do you avoid it in immutable types?

`BigDecimal.equals` compares both the unscaled value *and* the scale. `1.0` and `1.00` are not equal: they have scales 1 and 2 respectively. As a result, a `Money` record with a `BigDecimal` component fails as a `Map` key when the lookup `BigDecimal` was constructed with a different scale than the stored one.

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"));   // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")); // 0
```

The cure: normalise the scale at construction inside the immutable wrapper.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP);
    }
}
```

Now every USD `Money` has scale 2 and the cache works.

---

## Q9. What is the safe-publication idiom and why does it matter?

Safe publication is the rule: "before another thread observes a reference, the constructed object must be fully initialised and `this` must not have escaped." The idiom is *static factory method*:

```java
public final class Listener {
    private final String name;
    private Listener(String name) { this.name = name; }
    public static Listener register(String name, EventBus bus) {
        Listener l = new Listener(name);
        bus.subscribe(l);                              // publish AFTER construction
        return l;
    }
}
```

The constructor is private; the factory constructs the object completely, then publishes the finished reference. Without this, a thread could observe the partially-initialised object through the early-published reference and see `final` fields as their default values.

**Trap:** Calling `bus.subscribe(this)` from a constructor is the classic violation. The JLS §17.5 guarantee is forfeited.

---

## Q10. How does immutability enable lock-free programming?

The pattern: hold all mutable state as an *immutable snapshot* in an `AtomicReference`. Readers do a single volatile read; writers `updateAndGet` to swap the snapshot in a CAS loop.

```java
private final AtomicReference<Stats> state = new AtomicReference<>(Stats.EMPTY);

public void record(long sample) {
    state.updateAndGet(s -> s.with(sample));     // CAS, lock-free
}
public Stats snapshot() {
    return state.get();                           // single volatile read
}
```

Readers are *wait-free* — they cannot block, fail, or see torn values. Writers are *lock-free* — under contention they retry, but no thread can block another forever. The whole pattern depends on `Stats` being immutable: two threads that observe the same `Stats` reference must see identical contents, which is exactly what JLS §17.5 promises for `final` fields.

`CopyOnWriteArrayList`, `ConcurrentHashMap`'s bucket arrays, and almost every cache implementation in `java.util.concurrent` use this idiom.

---

## Q11. Critique this snippet from an immutability standpoint.

```java
public final class Order {
    private final long id;
    private final List<LineItem> items;
    public Order(long id, List<LineItem> items) {
        this.id = id;
        this.items = items;
    }
    public List<LineItem> items() { return items; }
}
```

Two leaks: (1) the constructor stores the caller's `items` reference directly, so anyone holding that reference can mutate the order's contents post-construction; (2) the accessor returns the same internal reference, so callers receive a handle they can mutate. Both bugs share one fix: `List.copyOf(items)` in the constructor. The accessor then returns a `List.copyOf` result, which is an unmodifiable list, so external callers cannot mutate what they receive.

```java
public Order(long id, List<LineItem> items) {
    this.id = id;
    this.items = List.copyOf(items);
}
```

**Follow-up:** "What if `List.copyOf` is slow?" It's not — for already-immutable inputs it returns the same instance. For a fresh `ArrayList` it allocates one immutable list and copies the references (not the elements). The allocation is in the noise for any application workload.

---

## Q12. When can you intentionally violate immutability?

Three legitimate situations. **One:** the class is a builder — a deliberately mutable construction helper with a `build()` method that returns an immutable result. *Effective Java* item 2 covers this; `StringBuilder` is the canonical case. **Two:** the class is a long-lived service or aggregate — a database connection pool, an in-memory cache, an inventory aggregate that evolves over time. Immutability would force replacement of the entire object on every event, which may be the wrong shape. **Three:** a framework demands setters (JPA entities, JAXB, certain DI containers); fighting the framework costs more than it buys, so accept mutability at that layer and push immutability into the values inside.

**Trap:** "I violated immutability for performance" is rarely the real reason — usually it's "I didn't think about it" or "the framework made me." Be honest about which.

---

## Q13. How does `final` differ from "immutable"?

`final` is a *language modifier* that says a variable cannot be reassigned. An immutable object's state cannot change at all. They're related but distinct:

- `final` *reference* to a mutable object: the variable can't be reassigned, but the object's contents can change (`final List<String> tags = new ArrayList<>(); tags.add("x");` is legal).
- Non-`final` *reference* to an immutable object: the variable can be reassigned to a different `String`, but neither `String` can mutate.
- `final` *reference* to an immutable object: neither the reference nor the contents can change. This is what you want for fields in an immutable class.

Bloch's rule 3 ("all fields `final`") gives you the first guarantee. The defensive copy in rule 5 gives you the second.

---

## Q14. What is the role of records (JEP 395) in the immutability story?

Records, introduced as preview in Java 14 (JEP 359) and finalised in Java 16 (JEP 395), collapse the boilerplate of immutable value classes. A `record Order(long id, String customer)` generates a `final` class with `private final` fields, a canonical constructor, accessors, and consistent `equals` / `hashCode` / `toString` — all automatically. That covers four of Bloch's five rules (no setters, `final` class, `private final` fields, no setters).

The one rule records do *not* automate is rule 5 — defensive copying of mutable components. That lives in the compact constructor:

```java
public record Order(long id, List<LineItem> items) {
    public Order {
        items = List.copyOf(items);
    }
}
```

Records have made "design the new type as immutable from the start" a one-line decision.

---

## Q15. Are mutable components in records ever acceptable?

Sometimes — for `record`-shaped *carriers* of mutable infrastructure (a logger, a database connection, an HTTP client). The class is "immutable in its dependencies" but those dependencies are not value-shaped immutable themselves. The vocabulary is: the record is *stateless* in user-facing semantics, not *immutable* in the value-object sense.

```java
public record OrderService(OrderRepository repo, Clock clock) {        // injected services
    // OrderRepository may hold a JDBC connection, internally mutable
}
```

This is fine — `OrderService` is treated as a static configuration, never compared for equality, never used as a `Map` key. The pattern is constructor-injection-via-record. But if you ever want value equality on a record, every component must be transitively immutable.

**Trap:** using a record as both a value carrier and a service holder. Pick one.

---

## Q16. Compare Java's approach to immutability with Scala's `case class` or Kotlin's `data class`.

All three converge on the same shape: a compiler-generated class with `final` fields, value-based `equals`/`hashCode`/`toString`, and a copy-with-modifications method.

- **Java `record`** (Java 16+) — final class, `private final` fields, accessors, `equals`/`hashCode`/`toString`. No `with*` method built in (you write it or use Lombok `@With`). Defensive copy is your job in the compact constructor.
- **Scala `case class`** — final by convention (case-to-case inheritance not allowed), `val` fields (Scala's `final`), built-in `copy(...)` method for `with*`-style modification, immutable collections by default.
- **Kotlin `data class`** — `val` (immutable) or `var` (mutable) properties, built-in `copy(...)`, `componentN()` accessors for destructuring, content-based `equals`.

Records are deliberately the most conservative — no surprises, no magic, transparent compilation. The Java direction (records + sealed types + pattern matching + future value classes) lands at roughly the same place by smaller steps.

---

## Q17. What is `List.copyOf`'s null behaviour and why?

`List.copyOf(Collection)` throws `NullPointerException` if any element is null. The Javadoc is explicit: the returned list "must not contain any null elements." This is a defensive-by-default choice — the JDK's modern immutable collection family (`List.of`, `List.copyOf`, `Set.of`, `Set.copyOf`, `Map.of`, `Map.copyOf`, `Map.entry`) all refuse nulls, both as elements and as keys/values.

The rationale: `null` is rarely intentional in a value-shaped collection, and silently storing one creates downstream NPEs far from the original error. Refusing at the boundary catches the bug at the moment of construction.

If you genuinely need nulls (e.g., a sparse list of optional entries), use a plain `ArrayList` wrapped in `Collections.unmodifiableList`, or `Stream.toList()` (which does allow nulls), or model the slots with `Optional<T>` instead.

---

## Q18. How do you make an immutable class thread-safe?

If it's truly immutable — `final` class, `final` fields, no `this` escape from the constructor — it's *already* thread-safe. JLS §17.5 guarantees publication of `final` fields without any synchronization. You can pass the reference between threads through any channel and the contents will be correctly visible.

The remaining concern is publishing the *reference* itself. If you hold an immutable object in a non-volatile field, other threads may not immediately see updates to that field. The fix is to publish through `AtomicReference`, a `volatile` field, a `synchronized` block, or one of the other happens-before edges.

```java
public final class Holder {
    private final AtomicReference<Snapshot> ref = new AtomicReference<>();
    public void publish(Snapshot s) { ref.set(s); }
    public Snapshot read()           { return ref.get(); }
}
```

Now both *content visibility* (from `final` fields in `Snapshot`) and *reference visibility* (from `AtomicReference`) are guaranteed.

---

## Q19. What does Project Valhalla (JEP 401) change for immutability?

JEP 401 introduces *value classes* — a long-awaited Project Valhalla feature. A value class has no identity (no `==` between instances, no `System.identityHashCode`, no `synchronized`), all fields implicitly `final`, and can be flattened by the JVM into arrays and other objects.

For immutability, JEP 401 is the next chapter:

- **No allocation cost for short-lived values.** `Point` lives in registers; `Point[]` is a flat array of `[x, y, x, y, ...]`.
- **No defensive copy needed across method calls.** A value class passed by value *is* the value; there's no shared reference to defend.
- **Stronger publication.** No reference exists to publish; the value is visible by definition.

The forward-compatible advice: design with records today as if Valhalla were imminent. Most JDK immutables (`Optional`, `LocalDate`, `Instant`) are already marked `@ValueBased` in preparation. Code written with `record` syntax today should largely run unchanged under future `value record` semantics.

---

## Q20. What is the strongest single change a team can make to improve immutability?

Pick one of two:

**(a)** Enable SpotBugs with `EI_EXPOSE_REP` and `EI_EXPOSE_REP2` at error severity in CI. Those two rules catch the constructor-stores-reference and getter-returns-reference bugs — the two most common immutability mistakes — with no false positives in practice. Most teams find dozens of legitimate findings the first time they enable it.

**(b)** Adopt the team policy "new domain types are records or `final` with `final` fields; deviations are documented in code". The policy fits in two paragraphs in a `CONVENTIONS.md`, costs nothing per PR once the team internalises it, and converges the codebase on immutable defaults over six to twelve months.

If you can do only one, do (a). If you can do both, you also need an ArchUnit rule blocking `java.util.Date` from new domain code, and the migration is essentially complete.

**Trap:** "Train the team on immutability" without enforcement. Training fades; CI rules don't.

---

**Use this list:** rotate one question from each cluster — fundamentals (Q1, Q2), defensive copying (Q3, Q4, Q5, Q11), JMM and concurrency (Q6, Q7, Q9, Q10), modern Java (Q14, Q19), and judgement (Q12, Q15, Q20). Strong candidates apply immutability as a *default* with named exceptions, can quote JLS §17.5 from memory, and know when defensive copying is wasted effort versus when it's the only thing standing between the app and a silent data-loss bug.
