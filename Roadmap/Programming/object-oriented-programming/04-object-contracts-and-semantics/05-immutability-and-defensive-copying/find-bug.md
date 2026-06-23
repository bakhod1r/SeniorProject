# Immutability and Defensive Copying — Find the Bug

> 10 buggy snippets, each illustrating a silent immutability violation that compiles, looks fine in review, and only bites in production or under test. For each: read the code, identify which one of Bloch's rules is broken, find the runtime symptom, and write the smallest fix.

---

## Bug 1 — Constructor stores the caller's list directly

```java
public final class Order {
    private final long id;
    private final List<LineItem> items;

    public Order(long id, List<LineItem> items) {
        this.id = id;
        this.items = items;                          // ← no defensive copy
    }

    public long id()                  { return id; }
    public List<LineItem> items()     { return items; }
}
```

```java
// Caller, in a controller:
List<LineItem> lines = new ArrayList<>();
lines.add(new LineItem("book", 1));
Order o = new Order(42, lines);
lines.add(new LineItem("pen", 3));                   // mutates the order!
System.out.println(o.items().size());                // 2
```

**Symptom.** An order placed at 10:00 with one line item has two line items by 10:01 because the caller still owns a reference to the same `ArrayList`. The price total is wrong, the warehouse picks an extra item, finance reconciles a discrepancy two days later.

**Violation.** **Rule 5** — the mutable component `items` is shared between the caller and the order. `final` only freezes the reference, not the contents.

**Fix.** Defensive copy in the constructor:

```java
public Order(long id, List<LineItem> items) {
    this.id = id;
    this.items = List.copyOf(items);                 // snapshot
}
```

`List.copyOf` returns an unmodifiable snapshot. The caller can keep mutating their `ArrayList`; the order is now independent.

---

## Bug 2 — Getter returns the internal mutable field

```java
public final class Customer {
    private final String name;
    private final List<Address> addresses = new ArrayList<>();

    public Customer(String name, List<Address> initial) {
        this.name = name;
        this.addresses.addAll(initial);
    }

    public String name()             { return name; }
    public List<Address> addresses() { return addresses; }     // ← leaked
}
```

```java
// Caller:
Customer c = new Customer("Alice", List.of(addr1, addr2));
c.addresses().clear();                                          // legal!
System.out.println(c.addresses().size());                       // 0
```

**Symptom.** A controller calls `customer.addresses()` and accidentally calls `.clear()` (or any other mutator) on the returned list — perhaps after a buggy "merge addresses" step that's supposed to clear a *copy* and forgets to copy first. The customer's stored addresses vanish; nobody can find them in audit because the database row was never updated.

**Violation.** **Rule 5** on the way *out*. The internal `ArrayList` reference escapes through the accessor.

**Fix.** Either (a) store the field as a `List.copyOf` snapshot at construction, or (b) copy on the way out. (a) is cheaper because you allocate once instead of once per call.

```java
public final class Customer {
    private final String name;
    private final List<Address> addresses;

    public Customer(String name, List<Address> initial) {
        this.name = name;
        this.addresses = List.copyOf(initial);
    }

    public List<Address> addresses() { return addresses; }      // safe — already immutable
}
```

---

## Bug 3 — A record with a mutable List component, no compact constructor

```java
public record Cart(String customerId, List<Item> items) { }
```

```java
List<Item> backing = new ArrayList<>();
backing.add(new Item("apple"));
backing.add(new Item("banana"));

Cart c = new Cart("c-7", backing);
backing.add(new Item("cherry"));                                // mutates Cart!
c.items().add(new Item("date"));                                // also mutates Cart!

System.out.println(c.items());                                  // 4 items
```

**Symptom.** Identical to bug 1, but the record's veneer of immutability makes the bug harder to spot in review. Reviewers see `record`, assume immutable, and move on. The cart is mutable in *both* directions — through the original `ArrayList` reference and through the accessor.

**Violation.** Records automate rules 1-4 of Bloch's recipe. **Rule 5** is still your responsibility.

**Fix.** Defensive copy in the compact constructor:

```java
public record Cart(String customerId, List<Item> items) {
    public Cart {
        items = List.copyOf(items);
    }
}
```

The compact constructor runs *before* the implicit field assignment, so the `final` field stores the unmodifiable snapshot. Now `cart.items().add(...)` throws `UnsupportedOperationException`, and the original `backing` list is independent.

---

## Bug 4 — `Collections.unmodifiableList` wrapping a list the caller still holds

```java
public final class TagSet {
    private final List<String> tags;
    public TagSet(List<String> tags) {
        this.tags = Collections.unmodifiableList(tags);         // ← wraps but doesn't snapshot
    }
    public List<String> tags() { return tags; }
}
```

```java
List<String> source = new ArrayList<>();
source.add("urgent");
TagSet t = new TagSet(source);

System.out.println(t.tags());     // [urgent]
source.add("internal");           // legal — source is still mutable
System.out.println(t.tags());     // [urgent, internal]    surprise
```

**Symptom.** A `TagSet` constructed with three tags is observed to have five tags a minute later because the *caller* still mutates the underlying `ArrayList`. The "unmodifiable" wrapper only forbids `t.tags().add(...)`; it doesn't isolate the contents.

**Violation.** **Confusion of "wrap" with "snapshot".** `Collections.unmodifiableList` is a view; the underlying list keeps mutating.

**Fix.** Use `List.copyOf`:

```java
public TagSet(List<String> tags) {
    this.tags = List.copyOf(tags);                              // snapshot, independent
}
```

`List.copyOf` is shorter, faster (skips the copy entirely if the input is already immutable), and produces a fully isolated list.

---

## Bug 5 — `String.split()` returns a mutable array

```java
public final class CommaSeparated {
    private final String[] parts;
    public CommaSeparated(String input) {
        this.parts = input.split(",");                          // ← returns a mutable array
    }
    public String[] parts() { return parts; }                   // ← leaks the array
}
```

```java
CommaSeparated cs = new CommaSeparated("a,b,c");
cs.parts()[0] = "MUTATED";
System.out.println(String.join(",", cs.parts()));               // "MUTATED,b,c"
```

**Symptom.** A configuration value parsed once at startup is observed to have been mutated by an unrelated component that asked for `parts()` and reused the slot for scratch data. The configuration appears to spontaneously change.

**Violation.** **Rule 5** on a mutable component that you might not think of as one — `String[]`. Arrays in Java are mutable; `final String[]` is a final *reference* to a mutable array.

**Fix.** Two options.

```java
// (a) Snapshot to an immutable List:
public final class CommaSeparated {
    private final List<String> parts;
    public CommaSeparated(String input) {
        this.parts = List.of(input.split(","));                 // List.of refuses nulls and is immutable
    }
    public List<String> parts() { return parts; }
}

// (b) Clone on input and output if the API must return an array:
public final class CommaSeparated {
    private final String[] parts;
    public CommaSeparated(String input) {
        this.parts = input.split(",");                          // already a fresh array; no further copy needed
    }
    public String[] parts() { return parts.clone(); }           // copy out on every call
}
```

Option (a) is the modern choice. Arrays as part of a public API are a smell — they're mutable and they don't fit `equals` cleanly.

---

## Bug 6 — Thread visibility of a non-final reference

```java
public final class Holder {
    public Snapshot current;                                    // ← not final, not volatile

    public void publish(Snapshot s) {
        current = s;
    }
}

public final class Snapshot {
    private final long version;
    private final Map<String, Integer> data;
    public Snapshot(long v, Map<String, Integer> d) {
        this.version = v;
        this.data = Map.copyOf(d);
    }
    public long version() { return version; }
    public Map<String, Integer> data() { return data; }
}
```

```java
// Thread A:
holder.publish(new Snapshot(1, someData));

// Thread B (may run before A's publish becomes visible):
Snapshot s = holder.current;
if (s != null) {
    s.data();                  // may NPE: Thread B could see current != null but s.data == null
}
```

Wait — this is more subtle. `Snapshot` *does* have final fields, so JLS §17.5 protects them. The bug is the *publication* of `current`: Thread B may see `current` as still `null` (or a stale reference) because the `Holder.current` field is not `volatile`. Once Thread B sees a non-null reference, the `final` fields of `Snapshot` are guaranteed correct — but it may take an arbitrary amount of time for B to observe the new reference at all.

**Symptom.** On a multi-socket production server, B reads stale data for seconds at a time after A publishes. The bug never reproduces under a local single-socket JVM because everything sits in one cache.

**Violation.** Confusion between *content visibility* (JLS §17.5, automatic for `final` fields) and *reference visibility* (requires a happens-before edge — `volatile`, `Atomic*`, `synchronized`, `Thread.start`/`join`, etc.).

**Fix.** Either declare `current` volatile, or use `AtomicReference`:

```java
public final class Holder {
    private final AtomicReference<Snapshot> current = new AtomicReference<>();
    public void publish(Snapshot s) { current.set(s); }
    public Snapshot current() { return current.get(); }
}
```

Now both *reference visibility* and *content visibility* are guaranteed.

---

## Bug 7 — `java.util.Date` in a "fortified" class

```java
public final class Reservation {
    private final long id;
    private final Date checkIn;
    private final Date checkOut;

    public Reservation(long id, Date checkIn, Date checkOut) {
        this.id = id;
        this.checkIn = checkIn;                                 // ← no copy
        this.checkOut = checkOut;
    }
    public Date checkIn()  { return checkIn; }                  // ← no copy
    public Date checkOut() { return checkOut; }
}
```

```java
Date in = new Date();
Date out = new Date(in.getTime() + 86_400_000);
Reservation r = new Reservation(1L, in, out);

in.setTime(0);                                                  // changes the reservation
r.checkIn();                                                    // Thu Jan 01 1970
```

**Symptom.** A booking system stores reservations with a 1970 check-in date because the input `Date` was reused by the caller as a scratch variable. Customer support gets calls about reservations they cannot find on the actual day.

**Violation.** **Rule 5.** `java.util.Date` is mutable (`setTime`, `setYear`, `setMonth`, ...). A `final Date` field stores a `final` reference to a mutable object.

**Fix.** Two options, in order of preference.

```java
// (a) Modern: use Instant. Immutable; no defensive copy needed.
public record Reservation(long id, Instant checkIn, Instant checkOut) { }

// (b) Legacy: defensive copy in and out.
public final class Reservation {
    private final long id;
    private final Date checkIn;
    private final Date checkOut;
    public Reservation(long id, Date checkIn, Date checkOut) {
        this.id = id;
        this.checkIn  = new Date(checkIn.getTime());
        this.checkOut = new Date(checkOut.getTime());
    }
    public Date checkIn()  { return new Date(checkIn.getTime()); }
    public Date checkOut() { return new Date(checkOut.getTime()); }
}
```

(a) is the right answer for any new code. (b) is the right answer when a legacy API or database driver hands you `Date` and you cannot replace it.

---

## Bug 8 — `BigDecimal` scale-equality trap

```java
public record Money(BigDecimal amount, Currency currency) { }
```

```java
Map<Money, String> labels = new HashMap<>();
labels.put(new Money(new BigDecimal("10.00"), USD), "ten dollars");

Money lookup = new Money(new BigDecimal("10.0"), USD);
labels.get(lookup);                                             // null — surprise!
```

**Symptom.** A pricing cache keyed by `Money` mysteriously returns nothing for values that "look identical" on screen. The cache hit rate is ~0 in production after a refactor that changed where `Money` instances are built.

**Violation.** `BigDecimal.equals` compares both the unscaled value and the **scale**. `10.00` has scale 2; `10.0` has scale 1; they are not equal. The record's auto-generated `equals` inherits this behaviour through `BigDecimal.equals`.

**Fix.** Normalise the scale at construction:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        amount = amount.setScale(currency.fractionDigits(), RoundingMode.HALF_UP);
    }
}
```

Now every USD `Money` has scale 2; `10.0` and `10.00` produce equal `Money` instances; the cache works.

This is more of an equality bug than a pure immutability bug, but it lives in the same neighbourhood — immutable types whose `equals` lies about value equality have most of the same symptoms as mutable ones. See [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) for the broader equality story.

---

## Bug 9 — Immutable record holding a mutable `Date`

```java
public record AuditEntry(long id, String actor, Date occurredAt, String action) { }
```

```java
Date now = new Date();
AuditEntry e = new AuditEntry(1L, "alice", now, "LOGIN");
now.setTime(0);                                                 // changes the audit entry's timestamp
System.out.println(e);                                          // AuditEntry[id=1, actor=alice, occurredAt=Thu Jan 01 1970, ...]
```

**Symptom.** Audit log entries that were written "now" have timestamps in 1970 in the database the next day. Compliance team raises an incident.

**Violation.** Same as bug 7, but inside a `record`. The class looks immutable because it *says* `record`, but the `Date` component is mutable and the record makes no defensive copy.

**Fix.** Replace `Date` with `Instant`:

```java
public record AuditEntry(long id, String actor, Instant occurredAt, String action) { }
```

`Instant` is immutable; no defensive copy is needed; the record is genuinely immutable. If the legacy database driver returns `Date`, convert at the boundary:

```java
public static AuditEntry fromRow(ResultSet rs) {
    return new AuditEntry(
        rs.getLong("id"),
        rs.getString("actor"),
        rs.getTimestamp("occurred_at").toInstant(),             // convert at the boundary
        rs.getString("action"));
}
```

The audit code itself never sees `Date`. The conversion lives in one place — the row mapper.

---

## Bug 10 — `final` reference to a mutable `ArrayList`

```java
public final class Inventory {
    private final Map<String, Integer> stockBySku = new HashMap<>();

    public void receive(String sku, int qty) {
        stockBySku.merge(sku, qty, Integer::sum);
    }
    public Map<String, Integer> stockBySku() {
        return stockBySku;                                      // leak
    }
}
```

```java
Inventory inv = new Inventory();
inv.receive("BOOK-1", 10);
inv.stockBySku().clear();                                       // legal!
inv.receive("BOOK-1", 5);
System.out.println(inv.stockBySku().get("BOOK-1"));             // 5, not 15
```

**Symptom.** Inventory counts mysteriously reset to zero in the middle of a busy day. The cause is a "diagnostic" code path that calls `inv.stockBySku().clear()` after capturing the snapshot for a report — the developer thought `.clear()` operated on the snapshot.

**Violation.** Two parts.

1. The field is `final`, but **`final` does not make the contents immutable**. `final Map` is a final reference to a `HashMap`.
2. The getter returns the live reference, so any caller can mutate the live `HashMap`.

This class is *mutable*, intentionally — it has a `receive` method. But the leaky getter exposes mutation paths the class did not intend to offer.

**Fix.** Return an unmodifiable view (or, better, an immutable snapshot, depending on freshness semantics):

```java
public Map<String, Integer> stockBySku() {
    return Collections.unmodifiableMap(stockBySku);             // read-only view
}
```

Or — if the class wants to *be* immutable — accept the entire stock state in the constructor and remove `receive`. The shape you want depends on whether you're modelling an evolving inventory or a snapshot of one.

If you're modelling a snapshot, make it a record and pass the full map:

```java
public record InventorySnapshot(Map<String, Integer> stockBySku) {
    public InventorySnapshot {
        stockBySku = Map.copyOf(stockBySku);
    }
}
```

If you're modelling the evolving aggregate, keep the mutable internal state but never leak the live reference.

---

## Pattern summary

| Violation type                                          | What to look for                                                  |
|---------------------------------------------------------|-------------------------------------------------------------------|
| Missed defensive copy on input (Bugs 1, 7, 9)           | Constructor body `this.field = arg;` for `List`, `Map`, `Date`, `int[]`, `byte[]` |
| Missed defensive copy on output (Bugs 2, 5, 10)         | Getter `return this.field;` for the same mutable types            |
| Record with a mutable component (Bugs 3, 9)             | A `record` declaration whose components include `List`, `Map`, `Date`, an array, with no compact constructor |
| `unmodifiableList` confused with `copyOf` (Bug 4)       | `Collections.unmodifiableList(callerSuppliedList)` stored in a field |
| Mutable array as a public component (Bug 5)             | `String[]`, `byte[]`, `int[]` as a record component or class field |
| Reference visibility vs content visibility (Bug 6)      | A non-`volatile`, non-`AtomicReference` field publishing an immutable snapshot across threads |
| Mutable `Date` / `Calendar` (Bugs 7, 9)                 | Any `java.util.Date` or `java.util.Calendar` in new code           |
| `BigDecimal` scale-equality (Bug 8)                     | `BigDecimal` component without `setScale(...)` in the compact constructor |
| `final` reference to mutable container (Bug 10)         | `private final Map<...>` / `private final List<...>` that is mutated by the class itself and leaked through a getter |

These violations rarely produce a compile error. They show up as: silent data drift, audit timestamps that go back to 1970, inventory counts that reset to zero, cache hit-rates of zero, customer-support tickets about "the database changed our data". Train your eye to spot them in review — the compiler does not catch them, and `record` does not save you. The fix is mechanical: every mutable component needs a defensive copy on input, an immutable view on output (or no output of the live reference at all), and — when in doubt — a replacement of the mutable type with its immutable counterpart.

SpotBugs `EI_EXPOSE_REP` and `EI_EXPOSE_REP2` catch bugs 1, 2, 4, 5, 7, 9, 10 reliably. Enabling them at error severity converts most of this file into a CI failure rather than a code-review discussion. Bugs 3, 6, 8 still need human eyes.
