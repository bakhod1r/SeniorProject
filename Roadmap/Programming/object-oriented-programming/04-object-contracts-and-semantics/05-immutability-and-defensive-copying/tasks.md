# Immutability and Defensive Copying — Practice Tasks

Eight exercises that force immutability discipline to bite. Most are refactors of code that *compiles fine* but breaks the moment a caller holds a reference for one millisecond longer than the original author expected. Domains: order management, customer profiles, money, graph state, statistics counters, audit logs, persistent data structures.

Work each task in three passes: (1) read the snippet and name the rule of Bloch's recipe that is broken (1-5), (2) sketch the new shape on paper before touching the keyboard, (3) write code and a small test that would have caught the original problem.

---

## Task 1 — Convert a mutable `Order` class to a record with defensive copies

```java
public class Order {
    private long id;
    private String customer;
    private List<LineItem> items;
    private LocalDateTime placedAt;
    private OrderStatus status;

    public long getId() { return id; }
    public void setId(long id) { this.id = id; }
    public String getCustomer() { return customer; }
    public void setCustomer(String c) { this.customer = c; }
    public List<LineItem> getItems() { return items; }
    public void setItems(List<LineItem> items) { this.items = items; }
    public LocalDateTime getPlacedAt() { return placedAt; }
    public void setPlacedAt(LocalDateTime t) { this.placedAt = t; }
    public OrderStatus getStatus() { return status; }
    public void setStatus(OrderStatus s) { this.status = s; }

    public BigDecimal total() {
        return items.stream().map(LineItem::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

**Objective.** Replace the mutable POJO with an immutable record that withstands callers holding the `items` reference and mutating it after the fact.

**Constraints.**
- The new type is a `record`.
- The `items` field is defensively copied via the compact constructor.
- `total()` is computed lazily by the accessor — no cached field.
- The class is `final` (records are by definition).

**Acceptance criteria.**
- A test that constructs an `Order` with a mutable `ArrayList<LineItem>`, then mutates that `ArrayList` after construction, observes the `Order.items()` *unchanged*.
- A test that calls `order.items().add(...)` throws `UnsupportedOperationException`.
- The `total()` test still passes — the calculation is identical.
- The class has no setters.

---

## Task 2 — Fix a constructor that stores the caller's list

```java
public final class Customer {
    private final long id;
    private final String name;
    private final List<Address> addresses;

    public Customer(long id, String name, List<Address> addresses) {
        this.id = id;
        this.name = name;
        this.addresses = addresses;                       // ← problem
    }

    public long id() { return id; }
    public String name() { return name; }
    public List<Address> addresses() { return addresses; }
}
```

**Objective.** Identify the leak, fix it in the minimal way, and write a test that would have caught it.

**Constraints.**
- The class signature stays the same.
- The fix is one line in the constructor.

**Acceptance criteria.**
- A test that constructs a `Customer` with `new ArrayList<>(List.of(addr1, addr2))`, then `add`s a third address to the original list, finds `customer.addresses()` still has size 2.
- A test that calls `customer.addresses().clear()` throws.
- The fix uses `List.copyOf` (not `Collections.unmodifiableList`).

---

## Task 3 — Replace `unmodifiableList` wrapping with `List.copyOf`

```java
public final class TagSet {
    private final List<String> tags;
    public TagSet(List<String> tags) {
        this.tags = Collections.unmodifiableList(tags);
    }
    public List<String> tags() { return tags; }
}
```

**Objective.** This class *looks* immutable but isn't. Identify why, then fix.

**Constraints.**
- Replace `Collections.unmodifiableList(...)` with the right call.
- Document in a one-line comment why this matters.

**Acceptance criteria.**
- A test that mutates the source `List` after construction observes the `TagSet` is unaffected.
- The fix changes exactly one method call.
- A second test demonstrates the *old* behaviour fails and the *new* passes.

---

## Task 4 — Design a `Money` value type with no setters

Build an immutable `Money` type that:

- Has two components: `amount` (a `BigDecimal`) and `currency` (a `Currency`).
- Normalises the scale at construction (USD → 2 fraction digits; JPY → 0).
- Offers `plus(Money)`, `minus(Money)`, `multipliedBy(BigDecimal)` that return *new* `Money` instances.
- Refuses to add two different currencies.
- Has correct `equals` / `hashCode` / `toString` for use as a `Map` key.

**Objective.** Write a record + compact constructor + arithmetic methods that follow all five of Bloch's rules and dodge the `BigDecimal` scale trap.

**Constraints.**
- Type is a record.
- Compact constructor normalises scale.
- Arithmetic methods do not mutate `this`; they return new instances.

**Acceptance criteria.**
- `new Money(new BigDecimal("1.0"), USD).equals(new Money(new BigDecimal("1.00"), USD))` is true.
- `new Money(amount, USD).plus(new Money(amount, EUR))` throws.
- `new HashMap<Money, String>()` can use `Money` as a key without surprises.
- A property-based test confirms `a.plus(b).equals(b.plus(a))` (commutativity).

**Hint.** Look up `Currency.getDefaultFractionDigits()`.

---

## Task 5 — Build an immutable graph with `with*` methods

Design a `Graph` of `Node`s and `Edge`s where:

- Adding a node returns a new `Graph` with the added node.
- Adding an edge returns a new `Graph` with the added edge.
- Removing either returns a new `Graph` without it.
- No mutation of the original `Graph` is possible.

```java
public record Graph(Set<Node> nodes, Set<Edge> edges) {
    public Graph { /* fill in */ }
    public Graph withNode(Node n)    { /* fill in */ }
    public Graph withEdge(Edge e)    { /* fill in */ }
    public Graph withoutNode(Node n) { /* fill in */ }
    public Graph withoutEdge(Edge e) { /* fill in */ }
}
public record Node(String id) { }
public record Edge(Node from, Node to, int weight) { }
```

**Objective.** Each `with*` / `without*` method returns a fresh `Graph` whose contents are independent of the original.

**Constraints.**
- The internal `nodes` and `edges` sets are immutable (`Set.copyOf`).
- The methods must work even on graphs of 1000+ elements without painful copies. (For this size, `Set.copyOf` is still fine. If you reach for Vavr or PCollections, document why.)
- An edge whose `from` or `to` is not in `nodes()` is allowed but the test should be able to detect orphan edges.

**Acceptance criteria.**
- Mutation methods on `g.nodes()` and `g.edges()` throw `UnsupportedOperationException`.
- `g.withNode(n).nodes().size() == g.nodes().size() + 1`.
- `g.equals(g.withNode(n).withoutNode(n))` is true.
- A test demonstrates that holding a reference to the original `g` and mutating a *local* `Set` does not affect `g`.

---

## Task 6 — Ensure thread-safety of a stats counter via immutable snapshots

```java
public class StatsCounter {
    private long count;
    private long sum;
    private long min = Long.MAX_VALUE;
    private long max = Long.MIN_VALUE;

    public synchronized void record(long sample) {
        count++;
        sum += sample;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
    }

    public synchronized Snapshot snapshot() {
        return new Snapshot(count, sum, min, max);
    }

    public record Snapshot(long count, long sum, long min, long max) { }
}
```

**Objective.** Rewrite so reads are *wait-free* and writes are *lock-free* by holding an immutable snapshot in an `AtomicReference`.

**Constraints.**
- No `synchronized` block in the rewrite.
- Use `AtomicReference.updateAndGet`.
- A reader calling `snapshot()` must never block a writer, and vice versa.

**Acceptance criteria.**
- A JMH benchmark with 8 reader threads + 2 writer threads shows the rewritten version with significantly higher reader throughput than the original.
- A correctness test with 1000 writers and 1 reader confirms the final snapshot has `count == 1000` exactly.
- The implementation file has no `synchronized` keyword.

---

## Task 7 — Replace mutable `Date` with `Instant`

You inherit this class:

```java
public final class AuditEntry {
    private final long id;
    private final String actor;
    private final Date occurredAt;
    private final String action;

    public AuditEntry(long id, String actor, Date occurredAt, String action) {
        this.id = id;
        this.actor = actor;
        this.occurredAt = new Date(occurredAt.getTime());
        this.action = action;
    }

    public long id()        { return id; }
    public String actor()   { return actor; }
    public Date occurredAt(){ return new Date(occurredAt.getTime()); }
    public String action()  { return action; }
}
```

**Objective.** Migrate to `Instant`, removing the defensive copies. Provide a converter for legacy callers that still pass a `Date`.

**Constraints.**
- The class becomes a `record`.
- The new component type is `Instant`.
- A static factory `AuditEntry.fromLegacy(long, String, Date, String)` converts `Date` to `Instant` at the boundary.
- Internally, nothing touches `Date`.

**Acceptance criteria.**
- A test that mutates a `Date` passed to `fromLegacy` does not affect the resulting `AuditEntry.occurredAt()`.
- The `AuditEntry.java` file contains no `import java.util.Date` *inside the class body* — only inside the boundary converter.
- The class has zero defensive-copy method calls (no `new Date(...)`).

---

## Task 8 — Design a persistent linked list

Design a `PersistentList<T>` (singly-linked) where:

- `PersistentList.empty()` returns the empty list.
- `list.prepend(t)` returns a new list with `t` at the head; the original is untouched.
- `list.tail()` returns the list without its head (the empty list if empty).
- `list.head()` returns the head or throws if empty.

```java
public sealed interface PersistentList<T> permits Cons, Nil {
    static <T> PersistentList<T> empty() { /* ... */ }
    boolean isEmpty();
    T head();
    PersistentList<T> tail();
    PersistentList<T> prepend(T t);
}
```

**Objective.** Implement the structure using two records: `Cons` (head + tail) and `Nil` (empty). Structural sharing — `prepend` is O(1) and shares the entire tail with the original list.

**Constraints.**
- `Cons` and `Nil` are records implementing the sealed interface.
- No mutable state anywhere.
- `prepend` allocates exactly one new node.

**Acceptance criteria.**
- A test that prepends 1000 elements to an empty list runs in linear time and allocates exactly 1000 nodes (verify via `-XX:+PrintEliminateAllocations` or a memory counter).
- Two lists derived from the same base by different prepends share the base's tail (verify by reference equality on the tails).
- `equals` works structurally (two lists with the same elements in the same order are equal).

---

## Validation

| Task | How to verify the fix |
|------|-----------------------|
| 1 | Mutate the source `ArrayList<LineItem>` after construction; `order.items()` is unchanged. |
| 2 | `customer.addresses().clear()` throws; mutating the source `List` after construction has no effect. |
| 3 | Mutating the source `List` after construction has no effect on `TagSet.tags()`. |
| 4 | `new Money(new BigDecimal("1.0"), USD).equals(new Money(new BigDecimal("1.00"), USD))` returns true. |
| 5 | `g.equals(g.withNode(n).withoutNode(n))` returns true; `g.nodes().add(...)` throws. |
| 6 | JMH shows higher reader throughput than the `synchronized` original; correctness test passes. |
| 7 | No `new Date(...)` call survives in the audit-entry code path; legacy boundary converter copies at the edge. |
| 8 | Prepending shares the tail by reference; 1000 prepends allocate exactly 1000 nodes. |

---

## Worked solution sketch — Task 4 (`Money` value type)

```java
public record Money(BigDecimal amount, Currency currency) implements Comparable<Money> {

    public Money {
        Objects.requireNonNull(amount,   "amount");
        Objects.requireNonNull(currency, "currency");
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP);
    }

    public static Money of(long units, Currency currency) {
        return new Money(BigDecimal.valueOf(units), currency);
    }

    public Money plus(Money other) {
        checkCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money minus(Money other) {
        checkCurrency(other);
        return new Money(amount.subtract(other.amount), currency);
    }

    public Money multipliedBy(BigDecimal factor) {
        return new Money(amount.multiply(factor), currency);
    }

    public boolean isPositive() { return amount.signum() > 0; }
    public boolean isZero()     { return amount.signum() == 0; }
    public boolean isNegative() { return amount.signum() < 0; }

    @Override
    public int compareTo(Money other) {
        checkCurrency(other);
        return amount.compareTo(other.amount);
    }

    private void checkCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException(
                "currency mismatch: " + currency + " vs " + other.currency);
        }
    }
}
```

Notice four things in the sketch:

1. The compact constructor enforces the scale invariant. Every USD `Money` has scale 2, regardless of how the caller built the `BigDecimal`. `new BigDecimal("1.0")` and `new BigDecimal("1.00")` both become scale 2 in storage.
2. Validation (null checks, currency match) happens after the scale normalisation. This is safe because `BigDecimal.setScale` is pure — it cannot have side effects on the input.
3. Arithmetic methods return *new* `Money` instances. No `this` is ever mutated.
4. The class implements `Comparable<Money>` — but only across the same currency. Comparing different currencies is undefined and throws, mirroring how `java.time` types refuse to compare a `LocalDate` to an `Instant`.

A representative property-based test using `jqwik`:

```java
@Property
boolean plusIsCommutative(@ForAll Money a, @ForAll("sameCurrency") Money b) {
    return a.plus(b).equals(b.plus(a));
}

@Provide("sameCurrency")
Arbitrary<Money> sameCurrency() { /* generates Money with USD only */ }
```

The test enforces a *mathematical* property of `Money` (commutativity) rather than a specific result. Property-based tests are particularly well-suited to immutable value types because the values are pure inputs and pure outputs — no setup, no teardown.

---

**Memorize this:** every task above is a *transformation* — name the broken rule (Bloch 1-5), point at the field, make the smallest move that removes the leak, write a test that would have caught it. Records collapse rules 1-4; the compact constructor is rule 5. `List.copyOf` snapshots; `Collections.unmodifiableList` wraps. For new code, prefer immutable JDK types (`Instant`, `LocalDate`, `BigDecimal` with normalised scale, `UUID`) over their mutable predecessors — the defensive-copy problem evaporates entirely.
