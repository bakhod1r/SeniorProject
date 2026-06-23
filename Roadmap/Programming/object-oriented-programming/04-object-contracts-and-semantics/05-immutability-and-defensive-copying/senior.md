# Immutability and Defensive Copying — Senior

> **What?** Why immutability is the spine of safe concurrency in Java, what JLS §17.5 actually promises about `final` fields, the "effectively immutable" pattern, identity-based caching, lock-free reads built on atomic reference swaps of immutable snapshots, the `BigDecimal` scale trap, and where the principle fights other forces — module boundaries, serialization, frameworks that demand setters.
> **How?** Treat immutability as a *thread-safety mechanism* before treating it as a design preference. The performance and reasoning wins follow; the locks you don't have to take pay for the discipline ten times over.

---

## 1. The `final`-field publication guarantee

The Java Memory Model is unusually generous to `final` fields. The relevant text is JLS §17.5: *"An object is considered to be completely initialized when its constructor finishes. A thread that can only see a reference to an object after that object has been completely initialized is guaranteed to see the correctly initialized values for that object's final fields."*

In plain English: if you write a class where every field is `final` and `this` does not escape the constructor, then **publishing the constructed reference to another thread is safe without any synchronization at all**. No `volatile`, no `synchronized`, no `Atomic*`. The JVM inserts the necessary fences for you, but only for `final` fields.

```java
public final class Money {
    private final long cents;
    private final Currency currency;
    public Money(long cents, Currency c) { this.cents = cents; this.currency = c; }
    public long cents() { return cents; }
    public Currency currency() { return currency; }
}

class Holder {
    Money latest;                                  // not volatile!
    void update(long c, Currency cur) {
        latest = new Money(c, cur);                // publish to other threads
    }
}
```

Once `latest` is assigned, any thread that reads `latest` and gets a non-null reference is *guaranteed* to see `cents == c` and `currency == cur`. There is no race on the contents of `Money`. The guarantee comes from `Money`'s `final` fields plus the absence of `this` escape during construction.

Compare with a mutable class that lacks the guarantee:

```java
public class Mutable {
    public long cents;            // not final
    public Currency currency;     // not final
}
```

A thread that reads `holder.latest` may legally see `cents == 0` and `currency == null` *after* the publishing thread has clearly initialised both — because non-final fields are subject to the regular happens-before rules, and "I just assigned the reference" doesn't establish happens-before with another thread's read.

This single guarantee is why immutable objects are the foundation of every lock-free idiom in `java.util.concurrent`.

---

## 2. `this` must not escape the constructor

The publication guarantee has one teeth-baring caveat: **`this` must not escape during construction.** If the constructor leaks `this` (registers a listener, starts a thread, stores `this` in a static map), another thread may observe the partially-constructed object — and the `final`-field guarantee is forfeit.

```java
public final class EventBusListener {
    private final String name;
    public EventBusListener(String name, EventBus bus) {
        this.name = name;
        bus.subscribe(this);                              // `this` escapes!
    }
}
```

If another thread receives the `this` reference through `bus.subscribe`, it can call `getName()` and observe `null` for `name` — even though `name` is `final`.

The fix is a static factory that publishes only after construction is done:

```java
public final class EventBusListener {
    private final String name;
    private EventBusListener(String name) { this.name = name; }

    public static EventBusListener register(String name, EventBus bus) {
        EventBusListener l = new EventBusListener(name);
        bus.subscribe(l);                                  // publish after construction
        return l;
    }
}
```

This pattern shows up under many names — *Static Factory Method* (Effective Java item 1), *Safe Publication Idiom*, *Late Binding of Self*. They all enforce the same rule: finish constructing, then publish.

The runtime symptom of a `this` escape is a `NullPointerException` on a `final` field that "could not possibly be null" — appearing only under load on production, never in tests.

---

## 3. Effectively immutable

A class that is not declared with `final` fields can still be *effectively immutable* if you publish it safely. The pattern: construct the object, fully initialise its state, never mutate it again, then publish through a thread-safe channel.

```java
public class Snapshot {
    private long version;                               // not final — set after constructor
    private Map<String, Integer> data;

    public Snapshot() { /* empty */ }
    public void populate(long v, Map<String, Integer> d) {
        this.version = v;
        this.data    = Map.copyOf(d);
    }
}

// In the writer thread:
Snapshot s = new Snapshot();
s.populate(42, currentData);
holder.set(s);                                          // AtomicReference.set — happens-before
```

`Snapshot` is technically mutable, but the program guarantees:

1. After `populate`, no thread mutates the snapshot.
2. The reference is published through an `AtomicReference` (or a `volatile` field, or a `synchronized` block, or one of the other happens-before edges JLS §17.4.4 defines).

Any thread that observes the snapshot through that channel sees the final state. Frameworks that hate truly immutable classes — JPA wants no-arg constructors and setters, Jackson can be configured but is happier with setters — often hold *effectively immutable* objects.

**Caveat:** effective immutability is a *runtime* property; the type system doesn't enforce it. One careless caller mutates the snapshot, and you have a data race. True immutability via `final` + records keeps the compiler honest. Effective immutability is a fallback when the type system can't be the enforcer.

---

## 4. Lock-free programming on immutable snapshots

The cleanest concurrent design pattern in Java is: *the state is one immutable object held in an `AtomicReference`. Writers replace the reference; readers dereference it.* No locks, no contention on the read side, no torn reads.

```java
public final class CounterStats {
    private final long count;
    private final long sum;
    private final long min;
    private final long max;
    public CounterStats(long count, long sum, long min, long max) {
        this.count = count; this.sum = sum; this.min = min; this.max = max;
    }
    public CounterStats include(long sample) {
        return new CounterStats(count + 1, sum + sample,
                                Math.min(min, sample),
                                Math.max(max, sample));
    }
    public static final CounterStats EMPTY =
            new CounterStats(0, 0, Long.MAX_VALUE, Long.MIN_VALUE);
}

public final class StatsHolder {
    private final AtomicReference<CounterStats> ref =
            new AtomicReference<>(CounterStats.EMPTY);

    public void record(long sample) {
        ref.updateAndGet(s -> s.include(sample));      // CAS loop, lock-free
    }
    public CounterStats snapshot() { return ref.get(); }
}
```

Three properties of this design:

- **Readers are wait-free.** `snapshot()` is a single volatile read. It cannot block, cannot fail, cannot see a torn value. The result is a fully-formed `CounterStats` that will not change under the reader's feet.
- **Writers are lock-free.** `updateAndGet` is a CAS loop. Under contention, writers retry, but no thread can block another forever.
- **No reader-writer interference.** A reader never blocks a writer; a writer never blocks a reader. This scales linearly with cores on the read side and reasonably well on the write side as long as contention is moderate.

`ConcurrentHashMap` uses this pattern internally for its bucket arrays. `CopyOnWriteArrayList` uses it explicitly. `AtomicReference.updateAndGet` is the Java 8+ idiom that makes it a one-liner. The whole pattern depends on `CounterStats` being immutable — without that, two threads observing the same `CounterStats` after a swap might see different field values.

---

## 5. Immutability and identity-based caching

Immutability turns objects into values. Two `Money(100, USD)` instances are *equal*; they hold the same value. This unlocks caching strategies that would be unsafe for mutable objects.

**Interning.** A pool keyed by value, returning the same instance for equal inputs.

```java
public final class Currency {
    private static final ConcurrentHashMap<String, Currency> POOL = new ConcurrentHashMap<>();
    private final String code;
    private Currency(String code) { this.code = code; }
    public static Currency of(String code) {
        return POOL.computeIfAbsent(code, Currency::new);
    }
    public String code() { return code; }
}
```

Every caller of `Currency.of("USD")` gets the same instance. The pool is thread-safe (`computeIfAbsent`), the instances are immutable (safe to share), and `==` becomes valid for comparison alongside `equals` — a minor performance win and a major readability win.

The JDK does this for small `Integer`, `Long`, and `Short` values (-128..127, see `Integer.valueOf` and JLS §5.1.7). `String.intern()` is the literal version of the pattern.

**Memoisation of derived values.** Because an immutable object's identity is forever, you can cache derived values keyed by that object without worrying about staleness:

```java
private static final ClassValue<MetadataFor> META = new ClassValue<>() {
    @Override protected MetadataFor computeValue(Class<?> type) {
        return new MetadataFor(type);
    }
};
```

`ClassValue` (Java 7) is built precisely for this — a per-class cache that the JIT understands and that scales with constant-class loaders. Immutability of `Class` (it never changes after loading) is what makes this safe.

**Trap:** never intern user-provided strings or attacker-controllable values. The pool grows unbounded and there is no eviction. Interning is for *closed sets* (currencies, locales, type tags) where the set size is bounded by domain.

---

## 6. The `BigDecimal` scale trap

`BigDecimal` is immutable. Two `BigDecimal` values with the same numerical value can still fail `.equals(...)`:

```java
BigDecimal a = new BigDecimal("1.00");
BigDecimal b = new BigDecimal("1.0");
a.equals(b);            // false  — different scales (2 vs 1)
a.compareTo(b) == 0;    // true   — same numerical value
```

`BigDecimal.equals(Object)` compares both the unscaled value *and* the scale. `1.0` and `1.00` are distinct as `BigDecimal` objects, even though they would print the same in most formats and have the same `compareTo` result.

This bites three ways:

- **As a `Map` key.** `Map<BigDecimal, String> m`; `m.put(new BigDecimal("1.0"), "a"); m.get(new BigDecimal("1.00"))` returns `null`. The hash and equals see different scales.
- **In `Set.contains`.** Same reason.
- **In tests.** `assertEquals(new BigDecimal("1.0"), new BigDecimal("1.00"))` fails. Use `assertEquals(0, a.compareTo(b))` or wrap in a custom value type.

The fix is to *normalize the scale at construction*:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        amount = amount.setScale(currency.fractionDigits(), RoundingMode.HALF_UP);
    }
}
```

After this, every `Money` for USD has scale 2; `equals` and `hashCode` behave the way the domain expects. The lesson generalises: an immutable wrapper around `BigDecimal` is almost always wrong without explicit scale handling. See [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) for the broader story on `equals` on numeric types.

---

## 7. Immutability across module boundaries

Inside one module, immutable means immutable. Across modules — particularly when a foreign caller can use reflection — the guarantee weakens.

**Reflection.** Any caller with `setAccessible(true)` can modify a `private final` field. The JLS does not promise that reflectively modified `final` fields are reliably observed by other threads, but it also doesn't prevent the modification.

**Unsafe.** `sun.misc.Unsafe` / `jdk.internal.misc.Unsafe` can write to any address. Used widely in `varhandles` and concurrency utilities. Not portable to your code; mentioned for completeness.

**Defenses:**

1. **JPMS (`module-info.java`).** A module that does not `open` its packages denies reflective access to non-public members. This is the strongest defence — a module that wants to reflect into yours must declare the intent.

```java
module com.example.orders {
    exports com.example.orders.api;
    // no `opens` — internal state is not reflectively reachable from outside
}
```

2. **Sealed types + records.** Reduce the surface area an attacker would target. A sealed hierarchy of records is fully enumerable; no `MyEvilSubclass` can sneak in.

3. **Don't trust deserialised objects.** Java serialisation can construct any class without running its constructor, bypassing validation entirely. If a class is immutable for safety reasons (cryptographic keys, audit records), implement `readResolve()` to return a properly validated instance, or use a different serialisation format (Jackson with `@JsonCreator`, Protobuf with explicit builders).

The honest summary: in the same JVM, immutability is a *programmer-level* contract. A malicious caller with full reflection access can break almost any invariant. Across security boundaries (e.g., serialisation, JNI, plugins from untrusted code), additional measures are required. For most application code, `final` + module hygiene is plenty.

---

## 8. Immutability and the framework wars

Several framework idioms in widespread Java use are hostile to immutable types. Senior judgement is knowing which trade to make and where.

- **JPA / Hibernate.** Wants a no-arg constructor and setters for property access. Records are technically supported (Hibernate 6.2+) but for entity classes the framework still prefers mutable. *Solution:* use immutable *DTOs* between the application boundary and the domain; let JPA-managed entities be the only mutable layer.
- **Jackson.** Supports records natively; `@JsonCreator` on the canonical constructor or `@JsonProperty` on parameter names is rarely needed. Use `record`s for request/response DTOs without ceremony.
- **Spring `@ConfigurationProperties`.** Now supports records (Spring Boot 2.6+). For older versions, immutable POJOs with constructor binding (`@ConstructorBinding`) achieve the same.
- **Lombok `@Value`.** Generates an immutable class — `final`, all-args constructor, `@With` for copy modification. Predates records; useful for projects on Java 8/11 that cannot upgrade.
- **`equals`/`hashCode` of JPA proxies.** A Hibernate lazy proxy of an entity does not equal the entity itself by default. If you store JPA entities in `HashSet`, you may end up with the same entity twice. Either override `equals`/`hashCode` carefully or, better, keep equality at the value-object layer (immutable `OrderId`, immutable `CustomerId`) and not at the entity layer.

The general policy: **immutable for values, mutable when the framework demands it, and a clean conversion in between.** Don't fight Hibernate to make an entity immutable; instead, push the immutable types down into the domain *values* (`Money`, `Address`, `OrderId`) and let the *entity wrappers* be mutable when the framework insists.

---

## 9. Immutability under composition — propagation discipline

A class that holds a reference to another object is only as immutable as its weakest field. If `Order` is "immutable" but holds an `Inventory` reference that has setters, the order is mutable in observable behaviour.

```java
public record Order(long id, Inventory inventoryView) {       // !
    // inventoryView is a live, mutable reference — Order is NOT immutable
}
```

Two cures:

- **Hold a value, not a reference to a mutable aggregate.** If the order needs to remember the on-hand quantity at the time of placement, store the quantity (a `long`), not the inventory (a service).
- **Compose only with immutable types.** If every leaf in the field graph is immutable, the whole graph is immutable transitively.

The senior-level move is to *make a habit* of running the field types past the immutability checklist: `String`, `Instant`, `LocalDate`, `BigDecimal`, `UUID`, `Optional` of any of those, records of any of those, `List.copyOf`/`Map.copyOf` of any of those — all immutable. A `Connection`, `Logger`, `OkHttpClient`, `HikariDataSource`, `Cache` — all mutable. A field of the latter type in a "value" class is a smell.

For service-shaped classes that need both `final` injected collaborators *and* are correctly called immutable in the data sense, the answer is that the class is *immutable in its dependencies* but *stateless in its semantics*. Both are good properties; just keep the vocabulary straight.

---

## 10. Quick rules

- [ ] JLS §17.5 guarantees safe publication of `final` fields *without* synchronization — *if* `this` doesn't escape the constructor.
- [ ] Never publish `this` (subscribe to a bus, start a thread, register a listener) from inside a constructor. Use a static factory.
- [ ] Effective immutability requires safe publication (`volatile`, `AtomicReference`, `synchronized`); type-level immutability does not.
- [ ] Lock-free reads of state = `AtomicReference<ImmutableSnapshot>`; writers `updateAndGet`. No reader-writer interference.
- [ ] Intern only closed, bounded value sets (currencies, locales). Never intern attacker-controllable strings.
- [ ] Normalize `BigDecimal` scale at construction inside money types, or `equals` lies about value equality.
- [ ] Across modules, immutability is a contract; reflection and serialisation can break it. JPMS + `readResolve` are the defences.
- [ ] Frameworks that demand setters get DTOs at the boundary; the domain values stay immutable.
- [ ] An immutable class is only as immutable as the most mutable type it holds.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving immutability across a team and a codebase           | `professional.md`  |
| JLS §17.5, JEP 395 records, JEP 401 value classes           | `specification.md` |
| Spot the bug — 10 broken-immutability snippets              | `find-bug.md`      |
| Escape analysis, scalar replacement, allocation cost        | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Cross-references inside this section:

- [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) — stable `hashCode` is the consequence of immutability; `BigDecimal` scale traps live here too.
- [../03-clone-and-copy-semantics/](../03-clone-and-copy-semantics/) — defensive copies are the modern alternative to broken `Cloneable`.
- [../04-object-identity-vs-equality/](../04-object-identity-vs-equality/) — interning collapses identity for equal immutable values; Valhalla's value classes will go further.
- [../../03-design-principles/](../../03-design-principles/) — immutability is the substrate beneath SRP value carriers and DIP final-field injection.

---

**Memorize this:** immutability is first and foremost a *concurrency mechanism*. JLS §17.5 gives `final` fields a publication guarantee no other field gets — provided `this` does not escape the constructor. Build state as immutable snapshots, hold them in `AtomicReference`, and your reads become wait-free. The data-modelling wins follow from there. The two recurring traps are `BigDecimal` scale (normalize at construction) and mutable components in supposedly-immutable holders (an immutable shell over a mutable list is a mutable object). Across modules and serialisation, immutability needs JPMS and `readResolve` to stay honest.
