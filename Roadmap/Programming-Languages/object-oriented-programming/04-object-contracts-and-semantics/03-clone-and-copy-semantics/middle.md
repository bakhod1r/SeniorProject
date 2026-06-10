# Clone and Copy Semantics — Middle

> **What?** Concrete refactors from `Cloneable` to copy constructors, worked examples of shallow vs deep copy across realistic domains (orders, customers, audit logs, address books), the right way to copy collections, and the constructor-boundary defensive-copy idiom that separates "leaky" classes from "owned-state" classes.
> **How?** Each section starts with a class that *compiles fine* but leaks state through a copy mistake, names the smell, and walks the smallest change that removes it. The closing examples combine several techniques on one class.

---

## 1. Why one refactor per pattern beats abstract advice

Junior-level guidance lists the four copy idioms (`Cloneable`, copy constructor, static factory, record). Middle-level work is the *transformations*: starting from a real class with a real bug, applying the right idiom, ending with a class whose behaviour you can defend. None of the refactors below introduce a framework — they are all small structural moves the standard library already supports.

Every section follows the same rhythm: a faulty starting class, a one-sentence diagnosis, and the smallest diff that fixes it.

---

## 2. Refactor 1 — replace `Cloneable` with a copy constructor

A loyalty system has a `LoyaltyCard` that implements `Cloneable` because the codebase was started in 2008.

```java
public class LoyaltyCard implements Cloneable {
    private long number;
    private String holder;
    private int points;
    private List<Transaction> recent;

    @Override
    public LoyaltyCard clone() {
        try {
            LoyaltyCard c = (LoyaltyCard) super.clone();
            c.recent = new ArrayList<>(this.recent);    // shallow copy of the list elements
            return c;
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);                // unreachable, says the comment
        }
    }
}
```

Three things are wrong even before we talk about `Cloneable` as an idea. The class is *not final*, so a subclass that doesn't re-implement the deep-copy logic will inherit a broken clone. The catch-and-rethrow dance forces callers to deal with a vacuous checked exception in mind. And `super.clone()` returns `Object`, so the cast is unchecked.

Replace it with a copy constructor that says exactly what it does:

```java
public final class LoyaltyCard {
    private final long number;
    private final String holder;
    private int points;
    private final List<Transaction> recent;

    public LoyaltyCard(long number, String holder, int points, List<Transaction> recent) {
        this.number = number;
        this.holder = holder;
        this.points = points;
        this.recent = new ArrayList<>(recent);
    }

    public LoyaltyCard(LoyaltyCard other) {
        this(other.number, other.holder, other.points, other.recent);
    }
}
```

The class is `final` (no surprise subclass to keep in lockstep), the copy constructor has a clear signature, and the only mutable field — the list — is copied via the existing constructor. No checked exception, no cast, no native method. The diff is small, the win is large.

---

## 3. Refactor 2 — shallow vs deep copy on a `Customer` aggregate

A `Customer` holds an `Address` (mutable in this legacy codebase) and a list of recent `Order` references that the customer service wants to display.

```java
public class Customer {
    private final long id;
    private String name;
    private Address address;
    private List<Order> recentOrders;

    // Shallow copy — every reference is shared with the source:
    public Customer(Customer other) {
        this.id           = other.id;
        this.name         = other.name;
        this.address      = other.address;                 // SHARED — mutation leaks
        this.recentOrders = other.recentOrders;            // SHARED — mutation leaks
    }
}
```

Two leaks. If the calling code mutates `original.address.setCity(...)`, the copy sees it. If anyone calls `copy.recentOrders.add(...)`, the original sees it. A copy that shares mutable state isn't really a copy.

The honest deep copy treats each mutable field by intention:

```java
public class Customer {
    private final long id;
    private String name;
    private Address address;                          // mutable; must be copied
    private final List<Order> recentOrders;           // each Order is itself a record (immutable)

    public Customer(Customer other) {
        this.id           = other.id;
        this.name         = other.name;
        this.address      = new Address(other.address);          // deep copy of mutable field
        this.recentOrders = new ArrayList<>(other.recentOrders); // copy list spine; elements shared and safe
    }
}
```

How deep you go is a per-field judgement: `name` is a `String` (immutable, share); `address` is mutable (copy); the list spine is mutable (copy); `Order` is a record (immutable, share). The phrase "deep copy" is shorthand — what you actually do is *think per field*.

The longer-term fix is to make `Address` immutable as well. Then `new Address(other.address)` becomes pointless and `this.address = other.address` is correct.

---

## 4. Refactor 3 — copying collection-typed fields

A `Cart` originally stored its line items as an `ArrayList<LineItem>` field. Callers pass in a list and the cart hangs on to *that* list.

```java
public final class Cart {
    private final List<LineItem> lines;

    public Cart(List<LineItem> lines) {
        this.lines = lines;                 // reference leaks both ways
    }

    public List<LineItem> lines() { return lines; }
}
```

```java
List<LineItem> seed = new ArrayList<>(List.of(item1, item2));
Cart c = new Cart(seed);
seed.add(item3);                            // (1) caller mutates the source — cart sees it
c.lines().clear();                          // (2) caller mutates the accessor result — cart sees it
```

Both directions are wrong. The constructor takes a defensive copy; the accessor returns an unmodifiable view (or the immutable copy itself):

```java
public final class Cart {
    private final List<LineItem> lines;

    public Cart(List<LineItem> lines) {
        this.lines = List.copyOf(lines);        // unmodifiable copy at the boundary
    }

    public List<LineItem> lines() {
        return lines;                            // already unmodifiable — safe to share
    }
}
```

`List.copyOf` (added in Java 10) returns an unmodifiable `List` and *avoids* copying if the input was already an unmodifiable `List` of the same shape. You get the safety of `Collections.unmodifiableList(new ArrayList<>(...))` with a hint of zero-allocation optimisation. Use `Set.copyOf`, `Map.copyOf` analogously.

For the rare case you want a *mutable* but isolated copy inside the class — say, you're going to add to it later — use the constructor form:

```java
this.lines = new ArrayList<>(lines);      // mutable internal copy, decoupled from the caller
```

Either way, the principle is the same: **never store the reference your caller passes in**.

---

## 5. Refactor 4 — records as the immutable shortcut

A `BookingRange` used to be a mutable class with two setters. Code that needed a "before" and "after" called `clone()` and edited fields:

```java
public class BookingRange {
    private LocalDate start;
    private LocalDate end;

    public void setStart(LocalDate s) { this.start = s; }
    public void setEnd(LocalDate e)   { this.end   = e; }
}
```

Make it a record. Two field declarations, no setters, no copy:

```java
public record BookingRange(LocalDate start, LocalDate end) {
    public BookingRange {
        if (start.isAfter(end)) throw new IllegalArgumentException("start after end");
    }

    public BookingRange withStart(LocalDate s) { return new BookingRange(s, end); }
    public BookingRange withEnd(LocalDate e)   { return new BookingRange(start, e); }
}
```

The compact constructor enforces the invariant once. `withStart` and `withEnd` are the modern equivalent of "clone and edit a field" — they allocate exactly one new record, reuse the unchanged field, and surface their intent through their name. Callers who used to write `BookingRange copy = original.clone(); copy.setStart(today);` now write `BookingRange copy = original.withStart(today);` — and the new version is final, equal-by-fields, and `null`-checked in one place.

Records are also `Serializable`-friendly without any annotation. If you ever round-trip a value through a JSON or binary format, a record is the cheapest shape to maintain.

---

## 6. Refactor 5 — `Map.Entry.copyOf` and friends for entry-shaped values

The JDK ships a copy factory for `Map.Entry` too — useful when iterating a map and capturing snapshots of entries.

```java
List<Map.Entry<String, BigDecimal>> snapshot = new ArrayList<>();
for (Map.Entry<String, BigDecimal> e : pricesByRegion.entrySet()) {
    snapshot.add(Map.entry(e.getKey(), e.getValue()));      // immutable Entry, decoupled from the map
}
```

`Map.entry(k, v)` (Java 9) returns an unmodifiable entry — its `setValue` throws. Combined with `List.copyOf`, you get a snapshot list whose entries are immutable in both directions:

```java
List<Map.Entry<String, BigDecimal>> snapshot =
        prices.entrySet().stream()
              .map(e -> Map.entry(e.getKey(), e.getValue()))
              .collect(Collectors.collectingAndThen(Collectors.toList(), List::copyOf));
```

If the caller later mutates `prices`, the snapshot is unaffected. If a third party gets a handle on the snapshot, they cannot mutate it back. Defensive copy at the entry level, baked into the JDK.

---

## 7. Refactor 6 — `Date`, `Calendar`, arrays: the eternal mutable trap

Three types in `java.lang` and `java.util` are notoriously mutable and notoriously copied wrong: `java.util.Date`, `java.util.Calendar`, and primitive arrays.

```java
public final class AuditEvent {
    private final Date occurredAt;       // java.util.Date is MUTABLE
    private final byte[] payload;        // arrays are mutable

    public AuditEvent(Date occurredAt, byte[] payload) {
        this.occurredAt = occurredAt;    // leaks — caller can call setTime later
        this.payload    = payload;       // leaks — caller can flip a byte
    }

    public Date occurredAt() { return occurredAt; }    // leaks the other way
    public byte[] payload()  { return payload; }
}
```

The disciplined version:

```java
public final class AuditEvent {
    private final Date occurredAt;
    private final byte[] payload;

    public AuditEvent(Date occurredAt, byte[] payload) {
        this.occurredAt = new Date(occurredAt.getTime());
        this.payload    = payload.clone();
    }

    public Date occurredAt() { return new Date(occurredAt.getTime()); }
    public byte[] payload()  { return payload.clone(); }
}
```

Or — much better — migrate to `Instant`:

```java
public record AuditEvent(Instant occurredAt, byte[] payload) {
    public AuditEvent {
        Objects.requireNonNull(occurredAt);
        payload = payload.clone();           // compact constructor — defensive copy on the way in
    }

    @Override public byte[] payload() {
        return payload.clone();              // defensive copy on the way out
    }
}
```

`Instant` is immutable, so it doesn't need any copy. The `byte[]` still does, in both directions. The record's compact constructor is the natural place for the inbound copy; the explicit accessor override is the natural place for the outbound copy.

---

## 8. Refactor 7 — deep copy with nested mutable collections

A `Warehouse` holds a `Map<String, List<Bin>>` — by SKU, the list of physical bins that contain stock of that SKU. `Bin` is mutable (its `qty` changes when items are picked).

```java
public final class Warehouse {
    private final Map<String, List<Bin>> binsBySku;

    public Warehouse(Map<String, List<Bin>> binsBySku) {
        this.binsBySku = binsBySku;                  // leaks the whole structure
    }

    public Warehouse(Warehouse other) {
        this.binsBySku = new HashMap<>(other.binsBySku);    // shallow — lists and bins shared
    }
}
```

A shallow copy of a `Map<String, List<Bin>>` is barely a copy: the map spine is duplicated, but every list inside is shared, and every `Bin` inside every list is shared. A pick on one warehouse mutates `qty` on the other.

A correct deep copy walks every level:

```java
public Warehouse(Warehouse other) {
    Map<String, List<Bin>> copy = new HashMap<>();
    for (var e : other.binsBySku.entrySet()) {
        List<Bin> binList = new ArrayList<>(e.getValue().size());
        for (Bin b : e.getValue()) {
            binList.add(new Bin(b));        // copy each Bin via its own copy constructor
        }
        copy.put(e.getKey(), binList);
    }
    this.binsBySku = copy;
}
```

Three nested copies — map, list, element. Each level is necessary because each level is mutable. If `Bin` were a record, the inner loop would collapse to `new ArrayList<>(e.getValue())`. If both `Bin` and the lists were immutable, the whole thing would be `Map.copyOf(other.binsBySku)`. Each immutable layer removes one level of work.

The lesson is general: **the depth of your copy is the depth of mutability in your graph**. Make the leaves immutable and copying gets cheap; leave them mutable and every copy walks the whole structure.

---

## 9. Refactor 8 — defensive copies at the constructor boundary, combined

A `Reservation` for a coworking space holds a date range, a list of attendee ids, an optional signature blob, and a settings map. The original constructor is one big leak:

```java
public final class Reservation {
    private final long id;
    private final LocalDate from;
    private final LocalDate to;
    private final List<Long> attendees;
    private final byte[] signature;                  // may be null
    private final Map<String, String> settings;

    public Reservation(long id, LocalDate from, LocalDate to,
                       List<Long> attendees, byte[] signature,
                       Map<String, String> settings) {
        this.id        = id;
        this.from      = from;
        this.to        = to;
        this.attendees = attendees;                  // mutable, leaks
        this.signature = signature;                  // mutable, leaks
        this.settings  = settings;                   // mutable, leaks
    }
}
```

The disciplined constructor handles each field by its mutability category, including the null case for `signature`:

```java
public Reservation(long id, LocalDate from, LocalDate to,
                   List<Long> attendees, byte[] signature,
                   Map<String, String> settings) {
    if (from.isAfter(to)) throw new IllegalArgumentException("from after to");
    this.id        = id;
    this.from      = from;                                 // LocalDate is immutable — share
    this.to        = to;
    this.attendees = List.copyOf(attendees);               // unmodifiable copy
    this.signature = (signature == null) ? null : signature.clone();
    this.settings  = Map.copyOf(settings);                 // unmodifiable copy
}
```

Each line has one job. The constructor is the *only* place mutation could enter the object's state from outside. After construction, every field is either an immutable JDK type, an unmodifiable collection, or a privately owned byte array. The class's state is, for all practical purposes, sealed.

Accessors mirror the constructor:

```java
public List<Long> attendees()       { return attendees; }                                  // already unmodifiable
public byte[]     signature()       { return signature == null ? null : signature.clone(); }
public Map<String, String> settings() { return settings; }                                 // already unmodifiable
```

The `signature` getter still defensively copies because a `byte[]` is still mutable inside our class even though no setter exists. We hand the caller a fresh array each time.

---

## 10. When a copy constructor calls another copy constructor

A `BillingProfile` contains a `BillingAddress` and a `BillingMethod`, both of which are themselves mutable types with their own copy constructors. The outer copy constructor delegates downward rather than re-implementing the work:

```java
public final class BillingProfile {
    private final long customerId;
    private final BillingAddress address;
    private final BillingMethod method;
    private final List<TaxId> taxIds;

    public BillingProfile(BillingProfile other) {
        this.customerId = other.customerId;
        this.address    = new BillingAddress(other.address);     // delegate
        this.method     = new BillingMethod(other.method);       // delegate
        this.taxIds     = new ArrayList<>(other.taxIds);         // TaxId is immutable — list is enough
    }
}
```

Each layer owns its own copy semantics. The `BillingProfile` author doesn't need to know what `BillingAddress` keeps inside — they just call its copy constructor and trust it. This is the same compositional property a copy *should* have. With `Cloneable`, every level of the hierarchy has to play along correctly, which is exactly the FBCP-style fragility covered in `senior.md`.

---

## 11. The conversion table

A handy reference for the right move per field type:

| Field type                           | What to do in a copy constructor / `copyOf`         |
|--------------------------------------|----------------------------------------------------|
| primitive (`int`, `long`, ...)       | direct assignment                                  |
| `String`, `BigDecimal`, `BigInteger` | direct assignment (immutable)                      |
| `LocalDate`, `Instant`, ...          | direct assignment (immutable in `java.time`)       |
| record                               | direct assignment (immutable by language design)   |
| `enum`                               | direct assignment (one instance per value)         |
| `java.util.Date`, `Calendar`         | `new Date(other.getTime())` — copy, or migrate to `Instant` |
| `byte[]`, any primitive array        | `array.clone()`                                    |
| `Object[]`                           | `Arrays.copyOf(...)` or deep copy each element     |
| `List<T>`                            | `List.copyOf(...)` or `new ArrayList<>(...)` then deep-copy elements if mutable |
| `Set<T>`, `Map<K, V>`                | `Set.copyOf`, `Map.copyOf` analogously              |
| `Optional<T>`                        | direct assignment if `T` is immutable; otherwise unwrap, copy, re-wrap |
| mutable custom class                 | call that class's own copy constructor              |
| immutable custom class               | direct assignment                                   |

When you write a copy constructor, walk the field list and pick the row above. Most fields fall into the "direct assignment" rows; the few that don't are where bugs live.

---

## 12. When copy *constructors* fight inheritance

A copy constructor is *not* polymorphic — it always builds an instance of the class it's declared on. That's usually what you want, but it surprises people coming from `clone()`:

```java
public class Account {
    public Account(Account other) { ... }
}
public class PremiumAccount extends Account {
    public PremiumAccount(PremiumAccount other) { ... }
}

Account a = new PremiumAccount(...);
Account b = new Account(a);              // builds an Account, NOT a PremiumAccount — fields trimmed
```

`new Account(a)` produces a plain `Account` even though `a`'s actual type is `PremiumAccount`. If you need polymorphic copying — given an `Account`, get back the same concrete subtype — pair the copy constructor with a `copy()` method declared on the base and overridden in each subclass:

```java
public abstract class Account {
    protected Account(Account other) { ... }
    public abstract Account copy();
}
public final class PremiumAccount extends Account {
    private PremiumAccount(PremiumAccount other) { super(other); ... }
    @Override public PremiumAccount copy() { return new PremiumAccount(this); }
}
```

`copy()` is a covariant-return method (allowed since Java 5). Callers write `account.copy()` and the dispatch finds the right constructor. This is the only situation where you might genuinely want a "polymorphic clone" — and even here, the implementation is just a copy constructor with a virtual entry point.

---

## 13. Quick rules

- [ ] Replace `Cloneable` with a copy constructor or `copyOf` on first opportunity, especially in classes you own.
- [ ] In every copy constructor, walk the field list against the table in section 11 and pick the right move per field.
- [ ] Shallow copies of *mutable* containers leak both ways — use `List.copyOf`, `Set.copyOf`, `Map.copyOf` at constructors *and* accessors.
- [ ] Records collapse most copy problems; reach for them whenever the type is a value carrier.
- [ ] `Date`, `Calendar`, raw arrays — always copy in both directions, or migrate to `Instant`, records, or unmodifiable lists.
- [ ] Deep copy nests as deep as the mutability does — flatten by making leaves immutable, not by writing longer copy methods.
- [ ] For polymorphic copies, declare `abstract Account copy()` on the base; each subclass overrides with a covariant return.

---

## 14. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| `Cloneable` protocol details; FBCP; cycles; persistent structures      | `senior.md`        |
| Team policy, ArchUnit/Sonar rules, IDE traps, migration playbook       | `professional.md`  |
| JLS §Object.clone, §Cloneable, JEP 395 records                         | `specification.md` |
| Buggy snippets across clone/copy idioms                                | `find-bug.md`      |
| Native clone vs constructor; escape analysis; Valhalla flat copies     | `optimize.md`      |
| 8 hands-on copy and defensive-copy exercises                           | `tasks.md`         |
| Interview Q&A on clone and copy semantics                              | `interview.md`     |

---

**Memorize this:** every copy refactor reduces to two questions — *is this field already immutable?* and *who can mutate it after construction?* Match each field to its row in the conversion table, take a defensive copy at the constructor and the accessor for every mutable field, and prefer records over copy methods whenever the type can be a value carrier. The deep-copy/shallow-copy question evaporates the moment your leaves are immutable.
