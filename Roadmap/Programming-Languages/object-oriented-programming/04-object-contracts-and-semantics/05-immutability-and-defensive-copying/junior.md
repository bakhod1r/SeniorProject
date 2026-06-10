# Immutability and Defensive Copying — Junior

> **What?** An *immutable* object is one whose observable state cannot change after construction. *Defensive copying* is the technique you use at the edges of an object — constructor parameters in, getter return values out — to make sure a mutable component (a `List`, a `Date`, an array) cannot be modified by anyone holding a reference outside the class.
> **How?** Apply Joshua Bloch's five rules from *Effective Java* item 17 ("Minimize mutability"): no setters, declare the class `final`, every field `final` and `private`, and defensively copy any mutable component when it crosses the boundary of the class. In modern Java, records do most of this for you — but the *defensive copy* step is still yours.

---

## 1. Why immutability is the default you start from

Mutable objects are the source of most of the bugs you have not written yet. Three concrete payoffs justify the discipline:

- **Thread-safety for free.** An immutable object can be shared across threads without locks, without `volatile`, without `synchronized`. There is no race because there is no state to race over.
- **Stable hash keys.** A `Map<Customer, Address>` only works if `Customer.hashCode()` returns the same value for the same identity throughout the customer's lifetime. The moment a setter changes a field that participates in `hashCode()`, the key is lost — `map.get(customer)` returns `null` for a customer that is still in the map.
- **Predictability when you read code.** When `order.total()` returns `BigDecimal.valueOf(99)`, you know nothing else can secretly change it. You don't have to chase six setters, three listeners, and a reflective framework to know whether the value will still be 99 on the next line.

Compare these two `Customer` types:

```java
// Mutable — every method that returns it leaks a handle to the internals.
public class Customer {
    private String name;
    private List<Address> addresses;
    public void setName(String name) { this.name = name; }
    public List<Address> getAddresses() { return addresses; }  // shared reference
}

// Immutable — nothing about a Customer can change after the constructor returns.
public final class Customer {
    private final String name;
    private final List<Address> addresses;

    public Customer(String name, List<Address> addresses) {
        this.name = name;
        this.addresses = List.copyOf(addresses);              // defensive copy in
    }

    public String name() { return name; }
    public List<Address> addresses() { return addresses; }    // already immutable
}
```

The second version answers "what does this customer know?" with the same answer forever.

---

## 2. The five rules (Effective Java item 17)

Bloch's recipe is the canonical checklist for making a class immutable. Walk through it in order; if any rule is broken, the class is mutable, full stop.

1. **No methods modify the object's state.** No setters. No `void add(...)`. No `void clear()`.
2. **Declare the class `final`.** A subclass cannot add a setter, override a getter to lie about the state, or break the invariants of the parent.
3. **All fields are `final`.** The JLS guarantees that `final` fields, once assigned in the constructor, never change. The compiler enforces it.
4. **All fields are `private`.** Even `final` fields, if `public`, expose the field reference directly. A `public final List<...>` lets callers call `list.add(...)`.
5. **Defensively copy any mutable component.** If a field's type is mutable (`Date`, `List`, `int[]`), copy it on entry (in the constructor) and on exit (in the getter, if you return the live reference rather than an immutable view).

```java
public final class Order {                                       // rule 2
    private final long id;                                       // rule 3, 4
    private final List<LineItem> items;                          // rule 3, 4

    public Order(long id, List<LineItem> items) {
        this.id = id;
        this.items = List.copyOf(items);                         // rule 5 in
    }

    public long id()                  { return id; }
    public List<LineItem> items()     { return items; }          // rule 5 not needed:
                                                                 // List.copyOf returns
                                                                 // an unmodifiable list
}
```

No setter (rule 1). Class is `final` (rule 2). Both fields are `final` and `private` (rules 3, 4). The mutable `List<LineItem>` parameter is copied to a `List.copyOf(...)` snapshot (rule 5). The result is an `Order` that cannot be modified by anything.

---

## 3. Records do four of the five rules for you

Java 16 records (JEP 395) collapse rules 1-4 into one keyword:

```java
public record Order(long id, List<LineItem> items) { }
```

What the compiler generates:

- A `final` class (rule 2) with no `extends` (you can't add a parent that adds setters).
- Two `private final` fields named `id` and `items` (rules 3, 4).
- A canonical constructor that assigns the two fields.
- Accessors `id()` and `items()` (no setters — rule 1).
- `equals`, `hashCode`, `toString` derived from the fields.

The one rule the compiler *cannot* automate is **rule 5 — defensive copying** — because the compiler does not know whether `List<LineItem>` is mutable. To plug that hole, write a *compact constructor*:

```java
public record Order(long id, List<LineItem> items) {
    public Order {                                              // compact constructor
        items = List.copyOf(items);                             // defensive copy in
    }
}
```

The compact-constructor body runs *before* the implicit field assignments, so reassigning `items` to a copy snapshots the caller's list. The record's accessor `items()` returns the copy — and `List.copyOf(...)` returns an unmodifiable list, so the caller cannot mutate what they receive either.

`List.copyOf(...)` has a useful optimisation: if the argument is already an unmodifiable `List` (the JDK's own immutable variant), it returns the same instance instead of allocating. So defending against a mutable input costs nothing once the codebase converges on immutable collections.

---

## 4. The defensive-copy pattern at boundaries

The whole pattern is two copies: one on the way in, one on the way out (when needed).

```java
public final class Customer {
    private final String name;
    private final Date dateOfBirth;                              // legacy java.util.Date is mutable!

    public Customer(String name, Date dateOfBirth) {
        this.name = name;
        this.dateOfBirth = new Date(dateOfBirth.getTime());      // copy IN
    }

    public Date dateOfBirth() {
        return new Date(dateOfBirth.getTime());                  // copy OUT
    }
}
```

Why both copies are necessary:

- **Copy in.** Without the constructor copy, the caller holds the same `Date` object the class holds. They can call `dateOfBirth.setTime(...)` an hour later and silently change the customer's birthday. The class's state escapes through the constructor parameter.
- **Copy out.** Without the getter copy, the caller of `customer.dateOfBirth()` receives the same `Date` object. They can mutate it. They might not even mean to — passing it to a third-party library that calls `setTime` is enough.

`String` does not need defensive copying — it is immutable. `BigDecimal`, `LocalDate`, `Instant`, `Optional`, `UUID` are likewise immutable and pass through unchanged. The copy step exists only for mutable types. For new code, *prefer the immutable replacement*: `Instant` over `Date`, `LocalDate` over `Calendar`, `List.copyOf(...)` over a defensive-copied `ArrayList`.

---

## 5. `List.copyOf` versus `Collections.unmodifiableList`

These two utility calls look similar and are not the same.

```java
// Wraps the live list. Mutations to the underlying list are still visible through the wrapper.
List<String> view = Collections.unmodifiableList(source);
source.add("oops");                  // legal — source is still mutable
view.size();                          // sees the addition

// Copies the source. The new list is its own snapshot.
List<String> snapshot = List.copyOf(source);
source.add("oops");                  // legal on source
snapshot.size();                      // unchanged
```

`Collections.unmodifiableList` is a *read-only view* over a list someone else owns; if they keep mutating the underlying list, the "unmodifiable" view changes underneath you. `List.copyOf` is a *snapshot*: the new list has its own data, and the original list could be erased entirely without affecting the snapshot.

For immutability, you almost always want `List.copyOf`. The same applies to `Set.copyOf` and `Map.copyOf` (all from Java 10).

---

## 6. Common newcomer bugs

**Bug 1: storing the parameter reference directly.**

```java
public final class Order {
    private final List<LineItem> items;
    public Order(List<LineItem> items) {
        this.items = items;                                       // no copy!
    }
}
```

The caller still holds the list. They can call `items.add(...)` and the order's contents change. The `final` field protects the *reference* — not what the reference points to.

**Bug 2: returning the internal list directly.**

```java
public List<LineItem> items() {
    return items;                                                  // leaked
}
```

If `items` is a `new ArrayList<>(...)`, the caller can mutate it. Return `List.copyOf(items)` once, in the constructor, and the accessor is safe.

**Bug 3: a record with a mutable component.**

```java
public record Cart(List<Item> items) { }

Cart c = new Cart(new ArrayList<>(List.of(item1, item2)));
c.items().add(item3);                                              // works, mutates Cart!
```

The record's accessor returned the same `ArrayList` the caller passed in. Use the compact-constructor pattern from section 3 to fix it.

**Bug 4: thinking `final` makes the contents immutable.**

```java
private final List<String> tags = new ArrayList<>();
tags.add("oops");                                                  // legal — tags is final, contents aren't
```

`final` says the *variable* cannot be reassigned. `tags = new ArrayList<>()` would fail to compile after the first assignment; `tags.add(...)` is fine. Immutability of contents is the field's *type*, not its modifier.

---

## 7. Quick rules

- [ ] No setters. Not even a "convenience" one.
- [ ] Class is `final`. Use a `record` if you can.
- [ ] Every field is `private final`.
- [ ] Mutable components (`List`, `Date`, `int[]`, `byte[]`) are copied in the constructor.
- [ ] Mutable components are copied in the getter — *unless* the field already holds an immutable view (`List.copyOf`, `Instant`, `String`).
- [ ] Prefer immutable replacements (`Instant`, `LocalDate`, `List.copyOf`) over mutable types that need copying.
- [ ] Records get rules 1-4 free; you still write rule 5 in the compact constructor.
- [ ] `List.copyOf` snapshots; `Collections.unmodifiableList` only wraps.

---

## 8. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Refactoring mutable classes; records + defensive copies      | `middle.md`        |
| Concurrency, safe publication, lock-free reads               | `senior.md`        |
| Driving immutability across a team and a codebase            | `professional.md`  |
| JLS §17.5 final-field semantics, JEP 395, JEP 401            | `specification.md` |
| Spot the bug — 10 broken-immutability snippets               | `find-bug.md`      |
| Escape analysis, scalar replacement, allocation cost         | `optimize.md`      |
| Hands-on exercises                                           | `tasks.md`         |
| Interview Q&A                                                | `interview.md`     |

Cross-references inside this section:

- [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) — immutable objects make stable `hashCode` trivial.
- [../03-clone-and-copy-semantics/](../03-clone-and-copy-semantics/) — defensive copies are the modern alternative to `Cloneable`.
- [../04-object-identity-vs-equality/](../04-object-identity-vs-equality/) — immutable values often want value equality, not identity.
- [../../03-design-principles/](../../03-design-principles/) — immutability supports SRP (value carriers) and DIP (final fields injected by constructor).

---

**Memorize this:** an immutable class has no setters, is `final`, has only `private final` fields, and defensively copies every mutable component at the boundary — once on the way in, once on the way out. Records cover four of the five rules automatically; the defensive copy is still your job. When in doubt, prefer `Instant`/`LocalDate`/`List.copyOf` to mutable types and the whole defensive-copy step disappears.
