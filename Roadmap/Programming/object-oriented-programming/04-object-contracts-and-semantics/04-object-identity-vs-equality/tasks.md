# Object Identity vs Equality — Practice Tasks

Eight exercises that force the identity-vs-equality distinction to bite. Each starts from code that compiles fine but returns the wrong answer (or wastes resources) under specific conditions: large integers, non-pooled strings, deserialised singletons, classloader boundaries, identity-keyed maps with logical-equality keys. Work each task in three passes: (1) read the code and decide which contract is wrong, (2) sketch the fix on paper, (3) write the fix plus a test that would have caught the original bug.

Domains: order processing, ride dispatch, customer profile management, document parsing, plugin systems, distributed caching. Same shapes you'll meet in production.

---

## Task 1 — Fix three string-`==` bugs

```java
public final class OrderRouter {

    public Route route(Order order) {
        String region = order.shippingRegion();    // from JSON
        if (region == "US") return Route.NORTH_AMERICA;
        if (region == "EU") return Route.EUROPE;
        if (region == "APAC") return Route.ASIA;
        return Route.UNKNOWN;
    }

    public boolean isExpressEligible(Customer c) {
        return c.tier() == "GOLD" || c.tier() == "PLATINUM";   // from DB
    }

    public Optional<Discount> findDiscount(String promoCode, List<Discount> active) {
        for (Discount d : active) {
            if (d.code() == promoCode) return Optional.of(d);   // from request
        }
        return Optional.empty();
    }
}
```

The class has unit tests that hard-code the regions, tiers, and promo codes as literals. All three tests pass. In production, every input is a fresh `String` from JSON, the database, or an HTTP request — every `==` returns `false`.

**Objective.** Replace each `==` with the correct equality check, write a test that would have caught the bug.

**Constraints.**
- Use `.equals` or `Objects.equals` — pick consciously per site.
- Don't reintroduce NPE risk. Identify any line that could throw NPE under the new equality and protect it.
- Bonus: in `route`, replace the three-`String` dispatch with an `enum Region` or a sealed type — value comparison on enum constants is the strongest contract.

**Acceptance criteria.**
- `route(Order)` returns the correct route when `region` is a freshly-loaded JSON string.
- `isExpressEligible(Customer)` returns the correct answer for any `tier()` value, including `null` (decide whether `null` should be `false` or throw).
- `findDiscount` finds the discount when `promoCode` is freshly parsed from the request body.
- All three tests fail against the original code and pass against the fixed version.

---

## Task 2 — Fix the Integer cache surprise

```java
public final class CouponService {

    private final Map<Integer, Coupon> coupons;

    public boolean isValidForUser(Integer userId, Integer couponCode) {
        Coupon c = coupons.get(couponCode);
        if (c == null) return false;
        return c.allowedUsers().contains(userId);
    }

    public boolean isSameCoupon(Integer a, Integer b) {
        return a == b;
    }
}
```

`Set<Integer> allowedUsers()` returns a set of user IDs. Tests use user IDs `1`, `2`, `3`. They all pass. In production, user IDs are 6-digit numbers (`421337`, `998254`). `Set.contains(userId)` uses `Integer.equals`, which works correctly. But `isSameCoupon(a, b)` — used elsewhere — returns wrong answers for codes over 127.

**Objective.** Audit every comparison in the class. Fix `isSameCoupon`. Verify `isValidForUser` is *not* broken (it uses `Set.contains`, which uses `.equals` — but it's worth checking what `Set` impl is in play).

**Constraints.**
- Choose between `Objects.equals(a, b)`, `a.intValue() == b.intValue()`, or changing the parameter type to `int`. Justify the choice.
- If you change to `int`, audit all callers — they may be passing boxed values.
- Decide whether `null` `userId` or `couponCode` is allowed; document the choice with `Objects.requireNonNull` or `@Nullable`.

**Acceptance criteria.**
- `isSameCoupon(123, 123)` returns `true`. `isSameCoupon(1000, 1000)` returns `true`. `isSameCoupon(null, null)` returns `true` or throws (your choice, documented).
- A property-based test (with values from `0` to `1_000_000`) confirms the symmetry: every pair of equal values returns `true`, every pair of unequal values returns `false`.
- The original test passes — make sure you didn't break the existing tests by changing the parameter type.

---

## Task 3 — Build an `IdentityHashMap`-based cycle detector

You're writing a custom serialiser for a domain object graph. `Employee` may reference a `Manager` who references the same `Employee` back. A naive recursive serialiser will stack-overflow.

```java
public final class GraphSerialiser {

    public void serialise(Object root, JsonWriter out) {
        Set<Object> seen = ???;                  // (*)
        serialiseRec(root, out, seen);
    }

    private void serialiseRec(Object node, JsonWriter out, Set<Object> seen) {
        if (seen.contains(node)) {
            out.writeReference(node);
            return;
        }
        seen.add(node);
        writeFieldsRecursively(node, out, seen);
    }
}
```

**Objective.** Pick the right `Set<Object>` at line `(*)` and justify it.

**Constraints.**
- Two `Employee` instances with the same ID but different in-memory addresses are *different nodes* in the graph. The serialiser must visit both, even though they're "logically equal".
- The cycle detector must catch the case where a cycle returns to the *same Java object*.
- Implement `writeFieldsRecursively` by reflection: walk all non-static, non-transient fields; for each field of a reference type, recurse.

**Acceptance criteria.**
- Given an `Employee` referencing a `Manager` referencing the *same* `Employee`, the serialiser emits a `writeReference` on the second visit, doesn't infinite-loop, and exits cleanly.
- Given two `Employee` instances with equal IDs but distinct objects in a list, the serialiser emits both fully — not a reference for the second one.
- A test that runs against a known graph (e.g., `e1 -> m1 -> e1`) produces a deterministic output.
- The test for the second case (two equal Employees in a list) fails against a value-equality-based `Set<Object>` and passes against the identity-based one.

---

## Task 4 — Choose identity vs equality for a cache key

You need a cache keyed by parsed `Document` AST. Two questions:

```java
public final class AstCache {

    private final Map<Document, Ast> cache = ???;   // (*)

    public Ast parse(Document d) {
        return cache.computeIfAbsent(d, parser::parse);
    }
}
```

Three possible `Document` definitions:

```java
// A — record by path
public record Document(Path path, String content) {}

// B — class with identity equality (no .equals override)
public final class Document {
    private final Path path;
    private final String content;
    /* constructor + getters, NO equals/hashCode override */
}

// C — class with .equals on path only (content may change after caching)
public final class Document {
    private final Path path;
    private String content;
    /* mutable content, .equals based on path */
}
```

**Objective.** For each of A, B, C, decide whether the cache should be a `HashMap`, an `IdentityHashMap`, or *something else entirely* (e.g., `Map<Path, Ast>` keyed by path). Justify each choice.

**Constraints.**
- Case A: records have auto-generated `equals` over all components, including `content`. Mutating one field is impossible (records are immutable). Decide whether `HashMap<Document, Ast>` or `IdentityHashMap<Document, Ast>` makes sense.
- Case B: there is no value-equality contract for `Document`. The cache must decide: is "same object" the contract, or is "same path" the contract?
- Case C: `Document` is mutable. Caching a mutable object as a key is a known hazard. The cache may become stale if the content changes after insertion.

**Acceptance criteria.**
- For A, you can articulate why `HashMap<Document, Ast>` is the right call if you want value-equality caching, or why `Map<Path, Ast>` is even better (decoupled from the document object).
- For B, you can articulate that `IdentityHashMap<Document, Ast>` is honest (it says "I track this specific document object"), but that a `Map<Path, Ast>` is usually a better domain choice.
- For C, you can articulate that *neither* `HashMap` nor `IdentityHashMap` is fully safe — the mutable `Document` violates the equality contract. The right answer is to make `Document` immutable or to cache by path.
- Write a test that demonstrates the stale-cache bug in case C (insert, mutate, lookup, observe wrong result).

---

## Task 5 — Refactor enum comparisons

```java
public final class OrderProcessor {

    public void process(Order o) {
        if (o.status().equals(OrderStatus.NEW)) {
            transition(o, OrderStatus.PROCESSING);
            log.info("processing order");
        } else if (o.status().equals(OrderStatus.PROCESSING)) {
            transition(o, OrderStatus.SHIPPED);
        } else if (o.status().equals(OrderStatus.SHIPPED)) {
            transition(o, OrderStatus.DELIVERED);
        }
    }

    public boolean isTerminal(OrderStatus status) {
        return status.equals(OrderStatus.DELIVERED)
            || status.equals(OrderStatus.CANCELLED);
    }
}
```

`OrderStatus` is an enum: `NEW`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`.

**Objective.** Refactor every `.equals` on the enum to `==`. Verify the NPE-safety wins.

**Constraints.**
- Don't break the existing behaviour.
- After the refactor, identify a *new* test case that would have caught a `null` status (which `.equals` would have thrown on but the refactored `==` handles gracefully).
- Replace the if/else chain in `process` with a `switch` over the enum. Modern Java's pattern-matching switch is even better.

**Acceptance criteria.**
- All `.equals` calls on `OrderStatus` are replaced with `==`.
- `isTerminal(null)` returns `false` (with `==`) instead of throwing NPE.
- `process` uses a `switch` statement; the compiler verifies exhaustiveness over the enum.
- Performance bonus: include a tiny JMH benchmark showing that `==` on enums is faster than `.equals`. Document the magnitude (~ns).

---

## Task 6 — Design a dedupe service that works across classloaders

You write a plugin host. Plugins are loaded by separate `URLClassLoader`s; each plugin produces `Event` objects that the host collects. The host must deduplicate events: two `Event` objects with the same `eventId` count as one.

```java
public final class EventDedup {

    public Set<Event> deduplicate(List<List<Event>> fromPlugins) {
        Set<Event> all = ???;          // (*)
        for (List<Event> batch : fromPlugins) {
            all.addAll(batch);
        }
        return all;
    }
}
```

**The trap:** `Event` is a class defined in the host's *shared* classpath. Each plugin loads the same `Event.class` via the plugin's classloader — wait, *no*: if the host pre-loads `Event` and exposes it to plugins via the parent classloader, every plugin sees the *same* `Event` class. If each plugin loads `Event` independently, every plugin has its *own* `Event` class, and an `Event` from plugin A is `instanceof` different from an `Event` from plugin B.

**Objective.**

1. Pick the right `Set` implementation for line `(*)` — `HashSet`, `LinkedHashSet`, `IdentityHashMap`-backed set, or `TreeSet` with a comparator.
2. Decide whether `Event` must live in a shared parent classloader. If yes, document why; if no, design an alternative.
3. Verify that two `Event` objects with the same `eventId` (from different plugins, possibly different classloaders) deduplicate correctly.

**Constraints.**
- `Event` is a record: `record Event(String eventId, Instant occurredAt, byte[] payload)`.
- The auto-generated `equals` compares all components, *including the `byte[]`* — which uses `Object.equals` (identity) for arrays. Decide whether this is acceptable; if not, override `equals` on the record (records *can* override) to use `Arrays.equals`.
- Define the contract clearly: dedupe by `eventId` only, ignoring `occurredAt` and `payload`. Justify why.

**Acceptance criteria.**
- The `Set<Event>` implementation deduplicates by `eventId`, not by full record equality.
- A test loads `Event` from two separate classloaders and verifies that dedup still works (or, alternatively, asserts that cross-classloader dedup *requires* the shared parent classloader, and documents this requirement).
- The implementation doesn't use `IdentityHashMap` — that would be the wrong contract here.
- The hosting classloader configuration is documented in the task's README or in code comments.

---

## Task 7 — Safely compare `Optional` results

```java
public final class CustomerLookup {

    public Optional<Customer> findByEmail(String email) { /* ... */ }

    public boolean sameCustomer(Optional<Customer> a, Optional<Customer> b) {
        return a == b;                  // (*) probably wrong
    }

    public boolean hasCustomer(Optional<Customer> result) {
        return result != Optional.empty();   // (**) wrong contract
    }
}
```

**Objective.** Fix both lines. Decide on the right idiom.

**Constraints.**
- `Optional.empty()` returns the same instance every call (sentinel). `Optional.of(x)` always allocates fresh.
- Two non-empty Optionals with equal wrapped values *are* equal by `Optional.equals` (it compares wrapped values using `.equals`).
- The JEP 169 *value-based class* warning applies: `==` on `Optional`, `LocalDate`, etc. should be avoided — future JVMs may dedupe instances and break the assumption.

**Acceptance criteria.**
- `sameCustomer(opt1, opt2)` returns `true` whenever both Optionals wrap customers that `.equals` each other.
- `hasCustomer(opt)` returns `true` exactly when `opt.isPresent()` would.
- Use `Optional.isEmpty()` / `Optional.isPresent()` instead of `== Optional.empty()`.
- Use `Optional.equals(other)` instead of `==`.
- A unit test demonstrates that `Optional.of("abc") != Optional.of("abc")` (identity) but `Optional.of("abc").equals(Optional.of("abc"))` is `true`.

---

## Task 8 — Build a sentinel-value mechanism using identity

Design a non-blocking queue that can signal *shutdown* by returning a special sentinel instead of `null` (because `null` is a valid queue value in your domain).

```java
public final class WorkQueue<T> {

    private final BlockingQueue<T> backing = new LinkedBlockingQueue<>();
    public static final Object SHUTDOWN = new Object();

    public Object poll() {
        T item = backing.poll();
        return item != null ? item : (isShuttingDown ? SHUTDOWN : null);
    }
}

// consumer:
while (true) {
    Object next = queue.poll();
    if (next == queue.SHUTDOWN) break;     // (*) identity comparison
    if (next == null) { Thread.yield(); continue; }
    handle((T) next);
}
```

**Objective.** Verify that the design is correct, and improve it for type safety.

**Constraints.**
- `SHUTDOWN` is a sentinel — `==` is the correct contract.
- The current design returns `Object`, which forces the consumer to cast and lose type safety.
- Refactor to a *sum type* (sealed interface or `Either<T, Sentinel>`) that the consumer can `switch` on with pattern matching.

**Acceptance criteria.**
- The consumer doesn't cast. Pattern matching over a sealed `Result<T>` does the dispatch.
- The shutdown sentinel is identity-based and immune to value-collision (no `T` value can equal it).
- A test simulates: produce some items, signal shutdown, consume — the consumer should drain remaining items and *then* exit cleanly.
- Document why `==` on the sentinel is the right contract here (with a comment).
- Compare with a `null`-only approach (where `null` means "shutdown OR empty"): explain why the sentinel is better in a domain where `null` is a valid item.

---

## Validation

| Task | How to verify the fix |
|------|-----------------------|
| 1 | Load region/tier/promo from a non-literal source (e.g., `new String("US")`) and verify the routing/discount still works. |
| 2 | Run the property-based test with values 0..1_000_000; all equal pairs must compare equal. |
| 3 | Build a graph `e1 -> m1 -> e1`; serialise; assert that the recursion terminates and emits exactly one `writeReference`. |
| 4 | For case C, mutate `content` after caching; subsequent `parse` should detect the staleness (it won't — that's the point; the test demonstrates the contract violation). |
| 5 | Pass `null` as the status; the refactored `==` returns `false`, the original `.equals` threw NPE. |
| 6 | Across two classloaders, dedupe by `eventId`; assert size = number of distinct IDs, not number of inputs. |
| 7 | `Optional.of("abc").equals(Optional.of("abc"))` is `true`; assert `sameCustomer` returns `true` for that case. |
| 8 | Send shutdown; consumer exits; assert no items are dropped. |

---

## Worked solution sketch — Task 3 (cycle detector)

```java
public final class GraphSerialiser {

    public void serialise(Object root, JsonWriter out) {
        // Identity-based — two objects with equal payloads are still distinct nodes.
        Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        serialiseRec(root, out, seen);
    }

    private void serialiseRec(Object node, JsonWriter out, Set<Object> seen) {
        if (node == null) {
            out.writeNull();
            return;
        }
        if (seen.contains(node)) {
            // We've visited this exact object before; emit a back-reference.
            out.writeReference(System.identityHashCode(node));
            return;
        }
        seen.add(node);

        if (isPrimitiveOrString(node)) {
            out.writeValue(node);
            return;
        }

        out.beginObject();
        for (Field f : node.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            if (Modifier.isTransient(f.getModifiers())) continue;
            f.setAccessible(true);
            try {
                out.writeFieldName(f.getName());
                serialiseRec(f.get(node), out, seen);
            } catch (IllegalAccessException e) {
                throw new RuntimeException(e);
            }
        }
        out.endObject();
    }

    private static boolean isPrimitiveOrString(Object o) {
        return o instanceof String
            || o instanceof Number
            || o instanceof Boolean
            || o instanceof Character;
    }
}
```

Notice three things in the sketch:

1. The visited-set uses `IdentityHashMap` because graph identity is what we care about. Two equal `Employee` objects with the same ID are two separate vertices.
2. The back-reference is keyed by `System.identityHashCode(node)` — for the same process, identical objects always produce the same identity hash. This is *not* a guarantee for collision-freeness (two distinct objects can share an identity hash), but for the duration of a single serialisation, the cycle detector has already proven `==`-uniqueness, so the back-reference IDs are unambiguous *within this graph walk*.
3. The serialiser handles `null` cleanly with `== null`, which is the correct (and idiomatic) identity check against the singleton `null` reference.

A test that demonstrates the cycle handling:

```java
@Test void detectsCycle() {
    var alice = new Employee("Alice", null);
    var bob = new Manager("Bob", alice);
    alice.setManager(bob);

    var out = new RecordingWriter();
    new GraphSerialiser().serialise(alice, out);

    // Alice -> Bob -> reference-to-Alice. No stack overflow.
    assertThat(out.events()).contains("reference:" + System.identityHashCode(alice));
}

@Test void distinctEqualEmployeesAreTwoNodes() {
    var a1 = new Employee("Alice", null, /* id */ 42);
    var a2 = new Employee("Alice", null, /* id */ 42); // equal by content
    var list = List.of(a1, a2);

    var out = new RecordingWriter();
    new GraphSerialiser().serialise(list, out);

    // Both Alices are written fully — they are different vertices.
    assertThat(out.fullObjectWrites()).hasSize(2);
}
```

The second test fails against a `HashSet<Object>`-backed visited-set (which would dedupe by `.equals` and skip `a2`) and passes against the `IdentityHashMap`-backed one.

---

**Memorize this:** identity-vs-equality problems don't surface as compile errors; they surface the second time you ask the same question of two equal-but-distinct objects. Each task above gives you that "second time" up front: a string from JSON, an integer over 127, a deserialised singleton, a mutable cache key, a graph with a back-edge. If, after the fix, the right question (`same object?` or `same value?`) is being asked at every site — and the wrong question is unrepresentable — you've applied the contract correctly.
