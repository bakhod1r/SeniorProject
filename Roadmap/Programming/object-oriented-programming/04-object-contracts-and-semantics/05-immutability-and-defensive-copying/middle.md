# Immutability and Defensive Copying — Middle

> **What?** Worked refactors: turning a mutable `Order` class into a record, fixing constructors that leak the caller's list, choosing between `List.copyOf` and `Collections.unmodifiableList`, modelling "change" through `with*`-style copy builders, and reaching for persistent collections when a snapshot per write is too expensive.
> **How?** Each section starts from a class that compiles fine and ends with a version that callers cannot break by holding the reference longer than expected. The shape you want is: copy on input, expose immutable views, and represent "modification" as a new object.

---

## 1. Refactoring a mutable `Order` into a record

You inherit this from an older codebase. It is the kind of class that "works fine until somebody else holds it for a millisecond too long".

```java
public class Order {
    private long id;
    private String customer;
    private List<LineItem> items;
    private LocalDateTime placedAt;
    private BigDecimal totalCached;

    public long getId() { return id; }
    public void setId(long id) { this.id = id; }
    public String getCustomer() { return customer; }
    public void setCustomer(String c) { this.customer = c; }
    public List<LineItem> getItems() { return items; }
    public void setItems(List<LineItem> items) { this.items = items; }
    public LocalDateTime getPlacedAt() { return placedAt; }
    public void setPlacedAt(LocalDateTime t) { this.placedAt = t; }

    public BigDecimal total() {
        if (totalCached == null) {
            totalCached = items.stream()
                               .map(LineItem::lineTotal)
                               .reduce(BigDecimal.ZERO, BigDecimal::add);
        }
        return totalCached;
    }
}
```

Three smells: setters that mutate state, a leaky `getItems` that returns the underlying list, and a memoised `totalCached` that becomes stale if anything ever calls a setter or mutates `items` directly.

Step 1 — replace with a record, which gives rules 1-4 of Bloch's recipe:

```java
public record Order(long id, String customer, List<LineItem> items, LocalDateTime placedAt) {
    public BigDecimal total() {
        return items.stream()
                    .map(LineItem::lineTotal)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

The cached total is gone — recomputed on demand. The setters are gone. `id`/`customer`/`items`/`placedAt` are auto-generated `private final` fields. The class is final.

Step 2 — plug the one remaining hole: `items` is still mutable. A caller passing `new ArrayList<>(...)` keeps the reference and can mutate the order:

```java
public record Order(long id, String customer, List<LineItem> items, LocalDateTime placedAt) {
    public Order {
        items = List.copyOf(items);          // defensive copy in the compact constructor
    }

    public BigDecimal total() {
        return items.stream().map(LineItem::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

`List.copyOf(items)` returns an unmodifiable list, so the accessor `items()` is *also* safe — no second defensive copy needed on the way out. Two lines of work, four bugs eliminated.

Step 3 — replace the legacy `LocalDateTime` if you can. It is technically immutable, but `Instant` is the modern UTC-anchored choice for storage; `LocalDateTime` is for human-display contexts. If you choose to migrate, the record changes one field type and nothing else.

---

## 2. Defensively copying a mutable component that won't go away

Sometimes you must accept a `java.util.Date` from a third-party API or a legacy database row. You cannot replace it at the type level. The defensive-copy pattern remains the answer.

```java
public final class Reservation {
    private final long id;
    private final Date checkIn;          // legacy java.util.Date — mutable
    private final Date checkOut;

    public Reservation(long id, Date checkIn, Date checkOut) {
        this.id = id;
        this.checkIn  = new Date(checkIn.getTime());      // copy in
        this.checkOut = new Date(checkOut.getTime());     // copy in
        if (this.checkOut.before(this.checkIn))           // validate AFTER copy
            throw new IllegalArgumentException("checkOut before checkIn");
    }

    public long id()        { return id; }
    public Date checkIn()   { return new Date(checkIn.getTime()); }   // copy out
    public Date checkOut()  { return new Date(checkOut.getTime()); }  // copy out
}
```

Two non-obvious points:

- **Validate after copying.** If you validate on the parameter `checkIn` and then store it, a malicious caller could change `checkIn` between the validation and the store on a different thread. Always validate on the copy.
- **Don't trust `clone()`.** `Date.clone()` is fine because `Date` is final-ish in practice, but in general a subclass can override `clone()` to do anything — including stash the instance into a static field. `new Date(date.getTime())` is the safest copy.

For new code: `Instant`/`LocalDate`/`LocalDateTime`/`OffsetDateTime`/`ZonedDateTime` are all immutable. Once your domain uses them, this whole section becomes unnecessary.

---

## 3. Records with mutable components — the trap and the cure

A record looks immutable but only enforces *reference* immutability. A `record` with a `List<...>` component happily holds an `ArrayList` whose contents the caller can mutate forever.

```java
public record Cart(List<Item> items) {}

List<Item> backing = new ArrayList<>();
backing.add(new Item("apple"));
Cart c = new Cart(backing);

backing.add(new Item("banana"));      // visible through c.items()!
c.items().add(new Item("cherry"));    // visible through c.items()!
```

Two cures, applied in the compact constructor. Pick the right one for your call shape.

**Cure A — snapshot at construction time:**

```java
public record Cart(List<Item> items) {
    public Cart {
        items = List.copyOf(items);          // snapshot; caller's list cannot affect us
    }
}
```

This is the safest default. After construction, the cart has its own immutable view of its contents. The caller can rebuild their own `ArrayList` as much as they like.

**Cure B — accept only an unmodifiable list:**

```java
public record Cart(List<Item> items) {
    public Cart {
        items = Objects.requireNonNull(items);
        if (items.getClass().getName().contains("ImmutableCollections"))
            return;                                       // hot-path skip
        items = List.copyOf(items);
    }
}
```

You almost never want this — `List.copyOf` already short-circuits when the input is already an immutable list, so the explicit branch buys you nothing. The lesson is: trust `List.copyOf`, don't reinvent it.

**Trap to recognise in code review:** a record with `List`, `Set`, `Map`, `byte[]`, `int[]`, or `Date` components and *no compact constructor*. That is a record that lies about being immutable. The IDE happily generates the no-defence version; only humans add the copy.

---

## 4. `List.copyOf` versus `Collections.unmodifiableList`

The two utilities are constantly confused in PRs, and the difference shows up only at runtime.

| Property                        | `Collections.unmodifiableList(L)`              | `List.copyOf(L)`                                |
|---------------------------------|------------------------------------------------|-------------------------------------------------|
| Allocates a new list?            | No — wraps                                     | Yes — snapshot (skipped if input already immutable) |
| Reflects later writes to source? | **Yes** — the wrapper sees them               | No — independent snapshot                       |
| Allows `null` elements?          | Yes                                            | **No** — throws `NullPointerException`          |
| Throws on `add/remove`?          | Yes                                            | Yes                                             |
| Identity guarantee?              | A new wrapper each call                        | Returns the same instance if input is immutable |

```java
List<String> backing = new ArrayList<>(List.of("a", "b"));

List<String> wrapped = Collections.unmodifiableList(backing);
List<String> snapped = List.copyOf(backing);

backing.add("c");

System.out.println(wrapped.size());   // 3 — wrapper saw the addition
System.out.println(snapped.size());   // 2 — snapshot was independent
```

When `Collections.unmodifiableList` is right:

- You're wrapping a list you *own* and never mutate again, and you want to expose it to many callers without paying for one copy per call.
- You want to expose a view that *follows* a backing list that is being maintained somewhere else.

When `List.copyOf` is right:

- You're storing the list in a field and want guaranteed immutability regardless of what the caller does next. **This is the immutability case.** Use `List.copyOf`.

`Set.copyOf` and `Map.copyOf` work the same way and have the same semantics. `Map.copyOf` snapshots both keys and values.

---

## 5. "Modifying" an immutable: the `with*` builder pattern

Immutable does not mean unchangeable in the domain sense — it means unchangeable *per object*. To represent "the customer just changed their email", you return a new `Customer` with the new email, leaving the old one untouched.

The naive form, on a record, is a one-liner:

```java
public record Customer(long id, String name, String email, List<Address> addresses) {
    public Customer {
        addresses = List.copyOf(addresses);
    }
    public Customer withEmail(String newEmail) {
        return new Customer(id, name, newEmail, addresses);
    }
    public Customer withName(String newName) {
        return new Customer(id, newName, email, addresses);
    }
    public Customer addingAddress(Address a) {
        var next = new ArrayList<>(addresses);
        next.add(a);
        return new Customer(id, name, email, next);
    }
}
```

`addingAddress` allocates a fresh `ArrayList`, then relies on the record's compact constructor to `List.copyOf` it back into an immutable form. The cost is one allocation per change — and the win is that *every* `Customer` reference anywhere in the program continues to see the value it was given.

For records with many fields, an intermediate builder reduces boilerplate. The pattern is the same shape as Bloch's *Effective Java* item 2 builder, but the build target is immutable:

```java
public final class CustomerBuilder {
    private long id;
    private String name;
    private String email;
    private List<Address> addresses = List.of();

    public static CustomerBuilder from(Customer c) {
        return new CustomerBuilder()
                .id(c.id()).name(c.name()).email(c.email()).addresses(c.addresses());
    }
    public CustomerBuilder id(long id)              { this.id = id; return this; }
    public CustomerBuilder name(String name)        { this.name = name; return this; }
    public CustomerBuilder email(String e)          { this.email = e; return this; }
    public CustomerBuilder addresses(List<Address> a){ this.addresses = a; return this; }
    public Customer build()                          { return new Customer(id, name, email, addresses); }
}

// At the call site:
Customer next = CustomerBuilder.from(current).email("new@example.com").build();
```

The builder is mutable — *deliberately* — for a few microseconds. The output is immutable. This is the same trade-off `StringBuilder` makes versus `String`.

Some libraries (Lombok `@With`, Immutables.org) generate `with*` methods automatically from a record-shaped declaration. For a small project, hand-written is fine. For a project with thirty records and many fields each, generation pays for itself.

---

## 6. Persistent collections — structural sharing instead of full copy

`List.copyOf` snapshots the entire list. For a 1000-element list mutated once per second, that is a megabyte of allocation per second per "modification". Persistent data structures (Clojure-style) solve this by *sharing structure* across versions.

A persistent vector keeps a tree of nodes. Modifying one element creates new nodes only along the path from the root to that leaf — log32 of the size, typically 1-5 nodes for any realistic list. The rest of the tree is shared with the old version, which remains a valid, independent immutable value.

Java does not ship persistent collections in the JDK, but three libraries are well-maintained:

- **Vavr** (formerly Javaslang) — closest to Scala's collections; rich API.
- **Eclipse Collections** — large, performance-focused; offers both mutable and immutable, with persistent variants.
- **PCollections** — small, focused, JDK-compatible interfaces.

```java
// Vavr — persistent list, one element added:
io.vavr.collection.List<Item> base = io.vavr.collection.List.of(i1, i2, i3);
io.vavr.collection.List<Item> next = base.prepend(i0);     // O(1), shares tail

// Compare with java.util — full copy:
java.util.List<Item> javaNext = new java.util.ArrayList<>();
javaNext.add(i0);
javaNext.addAll(base);                                      // O(n), full copy
```

When persistent collections are worth pulling in:

- You build an immutable graph and want to add/remove edges without rebuilding the world each time.
- You snapshot a large structure many times per second for an undo-redo stack.
- You pass an immutable map through a pipeline of transformations, each appending one entry.

When they are not worth it:

- Your "immutable" objects have at most a handful of items. `List.copyOf` is faster than the persistent vector's log32 path because allocation in HotSpot is essentially a pointer bump.
- Your team does not know the library yet, and "we use Vavr now" is a bigger discussion than the performance saved.

For most domain code, `List.copyOf` is the right answer. Persistent collections are a tool you reach for once you have measured a hot path.

---

## 7. Avoid leaky views into mutable internals

Even with `final` fields and no setters, you can still leak.

```java
public final class Inventory {
    private final Map<String, Integer> stockBySku;
    public Inventory(Map<String, Integer> stock) {
        this.stockBySku = Map.copyOf(stock);
    }
    public Map<String, Integer> stock() {
        return stockBySku;                                    // safe — Map.copyOf is immutable
    }
    public Set<String> skus() {
        return stockBySku.keySet();                           // also safe — view of an immutable map
    }
}
```

This is fine. The `Map.copyOf` snapshot is immutable, `keySet()` over it is unmodifiable, and the inventory's state cannot escape.

The bug shape to watch for is the same idiom with a *mutable* internal store:

```java
private final Map<String, Integer> stockBySku = new HashMap<>();

public Map<String, Integer> stock() {
    return stockBySku;                                        // LEAKED — caller can mutate
}
```

Two fixes: store an immutable copy at construction (best), or return `Collections.unmodifiableMap(stockBySku)` on every call (read-only view; the caller can still observe future mutations).

The general rule: **don't expose internal collections by reference.** Either store them as immutable to begin with, or copy/wrap on the way out. The former is cheaper because you pay only once.

---

## 8. Validation belongs *after* copying

A subtle ordering bug: validate the input *after* you copy it, never on the parameter you received.

```java
public Reservation(Date checkIn, Date checkOut) {
    if (checkOut.before(checkIn))                              // validate parameter
        throw new IllegalArgumentException();
    this.checkIn  = new Date(checkIn.getTime());               // copy after validating
    this.checkOut = new Date(checkOut.getTime());
}
```

Across threads, a malicious caller can mutate `checkIn` between the validation and the copy — a classic *time-of-check-to-time-of-use* race. The fix is trivial:

```java
public Reservation(Date checkIn, Date checkOut) {
    this.checkIn  = new Date(checkIn.getTime());               // copy first
    this.checkOut = new Date(checkOut.getTime());
    if (this.checkOut.before(this.checkIn))                    // validate the copy
        throw new IllegalArgumentException();
}
```

This is a footnote in Effective Java item 50 ("Make defensive copies when needed"). It only bites in concurrent contexts, but it bites hard when it does.

---

## 9. Quick rules

- [ ] Mutable class → record + compact constructor + `List.copyOf` for collection components.
- [ ] Mutable component you cannot replace → `new Date(d.getTime())` / `arr.clone()` on input and output.
- [ ] Use `List.copyOf` / `Set.copyOf` / `Map.copyOf` instead of `Collections.unmodifiableList(new ArrayList<>(...))`.
- [ ] `Collections.unmodifiableList` is a view, not a snapshot — only use it when you own the backing list.
- [ ] Represent state changes as new objects via `with*` methods or a `from(existing).field(new).build()` builder.
- [ ] For very large structures with many "modifications", reach for Vavr / PCollections / Eclipse Collections.
- [ ] Validate *after* copying, never on the parameter directly.
- [ ] Never return an internal `Map` or `List` reference unless it is an immutable view.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Concurrency, safe publication, lock-free reads              | `senior.md`        |
| Driving immutability across a team and a codebase           | `professional.md`  |
| JLS §17.5 final-field semantics, JEP 395, JEP 401           | `specification.md` |
| Spot the bug — 10 broken-immutability snippets              | `find-bug.md`      |
| Escape analysis, scalar replacement, allocation cost        | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Cross-references inside this section:

- [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) — `equals` and `hashCode` on an immutable type can never go stale.
- [../03-clone-and-copy-semantics/](../03-clone-and-copy-semantics/) — `Cloneable` is the old way; defensive copies + records are the new way.
- [../04-object-identity-vs-equality/](../04-object-identity-vs-equality/) — two immutable objects with the same fields are *equal*, and (under Valhalla) may even share identity.
- [../../03-design-principles/](../../03-design-principles/) — immutability supports SRP (each record is one value carrier) and LSP (no inheritance, no surprise mutation).

---

**Memorize this:** the refactor from mutable to immutable is mechanical — declare `final`, drop the setters, take `List.copyOf` on every mutable component in the constructor, return immutable views from getters, and represent change as `with*` returning a new instance. Records do four of the five rules; the compact constructor is where you write the defensive copy. `List.copyOf` snapshots; `Collections.unmodifiableList` only wraps. When snapshot allocation hurts in profiling, reach for persistent collections — but only then.
