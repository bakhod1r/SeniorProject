# Clone and Copy Semantics — Junior

> **What?** "Copying" an object in Java means producing a *second* object whose state is materially the same as the first, but whose identity (`==`) is distinct. Java offers four ways to do this: `Object.clone()` via the `Cloneable` marker interface (legacy and broken), **copy constructors** (`public Foo(Foo other) {...}`), **static copy factories** (`Foo.copyOf(other)`), and **records** (no copy needed — they're immutable, just reuse the reference).
> **How?** Default to *no copy* (records, immutable types). When you must copy a mutable type, use a copy constructor or a static factory. Never implement `Cloneable` in new code. When a method receives a mutable collaborator and stores it as a field, take a defensive copy at the boundary so a caller's later mutation can't corrupt your state.

---

## 1. Why copy at all?

Objects in Java are passed by reference. When `service.placeOrder(order)` runs, both the caller and `service` hold the *same* `Order` instance — if either mutates a field, the other sees the change. That sharing is fine when both sides agree it's a value (records, `String`, `BigDecimal`). It is *not* fine when:

- A caller mutates a list it passed in, and a stored copy inside your class quietly changes.
- A return value gives the outside world a handle on your *internal* state, and they mutate it.
- Two threads need their own private copy to work on without locking.
- A history-keeping system needs a snapshot of an object at a point in time.

A copy is the answer in each case. The hard question is *how deep*.

```java
Address billing = new Address("Andijon", "Bukhara St 1");
Customer c = new Customer("Ali", billing);
billing.setStreet("New St 99");                 // c.address is the same Address — silently changes
```

If `Customer` had taken a copy of `billing` at construction, the caller's later mutation would not leak into `c`. That move — taking a copy *across a trust boundary* — is the single most useful copy idiom in Java.

---

## 2. `Cloneable` is broken — one-line summary

You will read about `Object.clone()` and the `Cloneable` marker interface in old textbooks. Joshua Bloch's *Effective Java*, item 13, explains why it's broken in six pages. The one-line version: `Cloneable` is a marker that changes how a `protected` `native` method on `Object` behaves, the protocol is fragile, the method returns `Object` (forcing casts), it throws a checked exception, and every level of the hierarchy must implement it correctly for the chain to work. **Do not use it in new code.** Whenever this guide mentions `Cloneable` from here on, treat it as a thing to *replace*, not adopt.

```java
// Don't do this in new code:
class Person implements Cloneable {
    @Override public Person clone() {
        try { return (Person) super.clone(); }
        catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

There is no scenario where the above is the best tool. The rest of this file teaches the three tools that *are*.

---

## 3. The copy constructor pattern

A copy constructor is just a constructor whose only parameter is another instance of the same class. It builds a new object whose fields are initialised from the argument's fields.

```java
public final class Address {
    private final String city;
    private final String street;

    public Address(String city, String street) {
        this.city   = city;
        this.street = street;
    }

    public Address(Address other) {                       // copy constructor
        this(other.city, other.street);
    }

    public String city()   { return city; }
    public String street() { return street; }
}
```

Three things to notice:

1. **Same class.** `new Address(other)` produces an `Address`, not the cast-flavoured `Object` you get from `clone()`.
2. **No checked exception.** A copy constructor does not throw `CloneNotSupportedException` — the compiler doesn't force callers to wrap calls in `try`.
3. **Explicit field choice.** The author of the class decides exactly which fields are copied, in which order. Nothing is implicit.

For classes with mutable fields, the copy constructor is the place to take a *deep* copy of those fields:

```java
public final class Customer {
    private final String name;
    private final Address address;
    private final List<Order> recentOrders;

    public Customer(Customer other) {
        this.name         = other.name;
        this.address      = new Address(other.address);             // deep copy mutable field
        this.recentOrders = new ArrayList<>(other.recentOrders);    // copy the list
        // (the Order references inside the list are still shared — see middle.md)
    }
}
```

How deep to go is a design decision, not a language one. Junior-level rule of thumb: if the field is itself mutable and could be observed by your caller, copy it; if it is an immutable type (`String`, `BigDecimal`, a record), reuse the reference.

---

## 4. Static copy factories — `Foo.copyOf(other)`

Java's standard library prefers static factory methods over constructors when the operation has a name worth pronouncing. For copying, the conventional name is `copyOf`:

```java
public final class Order {
    private final long id;
    private final List<LineItem> lines;

    private Order(long id, List<LineItem> lines) {
        this.id    = id;
        this.lines = lines;
    }

    public static Order copyOf(Order other) {
        return new Order(other.id, List.copyOf(other.lines));
    }
}
```

Static factories beat copy constructors in three small ways:

- **They have a name.** `Order.copyOf(o)` reads as "copy"; `new Order(o)` reads as "construct from".
- **They can return a cached instance.** If the input is already immutable and shareable, `copyOf` can return the argument unchanged. `List.copyOf(list)` does exactly this when `list` is already an unmodifiable `List`.
- **They are polymorphic in their return type.** `copyOf` can return an interface (`List<T>`) and pick the most appropriate implementation at runtime.

You'll see both idioms in modern code. They're equivalent for the purpose of replacing `Cloneable`. Most teams pick one and stay consistent inside a codebase.

---

## 5. The standard library already does this for you

The JDK ships static copy factories on every immutable collection type. Use them.

```java
List<String> snapshot = List.copyOf(mutableList);     // unmodifiable List, defensive copy
Set<Long>    snapshot = Set.copyOf(mutableSet);       // same for Set
Map<K, V>    snapshot = Map.copyOf(mutableMap);       // same for Map
```

Each returns an *unmodifiable* implementation. If the input is already an unmodifiable collection of the same kind, the factories may return the argument as-is — zero allocation. If the input is mutable, you get a fresh structure that the caller cannot reach back into. These are the right defaults for collection-typed fields:

```java
public final class Cart {
    private final List<LineItem> lines;

    public Cart(List<LineItem> lines) {
        this.lines = List.copyOf(lines);   // defensive copy at the constructor boundary
    }

    public List<LineItem> lines() { return lines; }   // already unmodifiable, safe to return
}
```

Caller passes a mutable `ArrayList`, mutates it later, `Cart.lines` is unaffected. Caller asks for `Cart.lines`, gets the unmodifiable view, can't mutate it. Two leaks closed in one line each.

---

## 6. Records — the immutable shortcut

When the type *is* a value (one or more fields, no behaviour beyond returning them), declare a record. Records are implicitly final, fields are `private final`, accessors and `equals`/`hashCode`/`toString` are generated. **You don't need to copy a record. You just reuse it.**

```java
public record Address(String city, String street) {}
public record LineItem(String sku, int quantity, BigDecimal price) {}
public record Money(long cents, Currency currency) {}
```

Passing a record around is safe — the receiver cannot mutate it because there are no setters. Storing a record as a field is safe — the same. Returning a record is safe. The "copy" question disappears.

For variants that need a small change, records pair with a "with" idiom — copy *most* fields and override one or two:

```java
public record Order(long id, Customer customer, List<LineItem> lines, OrderStatus status) {

    public Order withStatus(OrderStatus newStatus) {
        return new Order(id, customer, lines, newStatus);
    }
}
```

`withStatus` reuses every other field (no allocation beyond the new `Order` itself) and produces a new instance that differs in one field. This is the dominant copy idiom in modern Java — and it doesn't use `clone()` at all.

---

## 7. Shallow vs deep — the one-paragraph version

A **shallow copy** duplicates the *fields* of the object but reuses the *objects those fields point to*. A **deep copy** also duplicates the pointed-to objects, recursively. For primitives, immutable types (`String`, `BigDecimal`, records, `LocalDate`), and references you intend to share, shallow is correct and cheap. For mutable types you don't want to share (an `ArrayList`, a `Date`, a `byte[]`), shallow is dangerous — a caller's mutation of the original leaks into the copy. Junior rule: **shallow by default, deep across trust boundaries**. The `middle.md` file works examples of each.

---

## 8. Defensive copy at the constructor boundary

The most common place to take a copy is the constructor of a class that stores a mutable value passed by the caller. Without the copy, the caller still owns the original and can mutate it from outside.

```java
public final class Booking {
    private final LocalDate start;
    private final LocalDate end;
    private final List<Guest> guests;
    private final byte[] signature;

    public Booking(LocalDate start, LocalDate end, List<Guest> guests, byte[] signature) {
        this.start     = Objects.requireNonNull(start);             // LocalDate is immutable, no copy
        this.end       = Objects.requireNonNull(end);
        this.guests    = List.copyOf(guests);                       // defensive copy
        this.signature = signature.clone();                         // arrays are mutable — copy
    }

    public byte[] signature() { return signature.clone(); }         // return a copy, never the field
}
```

`LocalDate` is immutable (final, all fields final, well-behaved), so sharing it is safe. A `List<Guest>` is mutable by default and a `byte[]` is always mutable — both get copied at the boundary, both get copied again on the way out. This pattern is the heart of *defensive copying*, covered in depth in [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/).

---

## 9. Common newcomer mistakes

**Mistake 1: implementing `Cloneable` because an IDE offered to.**

IntelliJ and Eclipse can both "Generate clone()" for you. The result is technically valid Java, semantically wrong choice. Delete it; write a copy constructor.

**Mistake 2: forgetting that an array field is mutable.**

```java
public final class Token {
    private final byte[] bytes;
    public Token(byte[] bytes) { this.bytes = bytes; }     // wrong — caller still holds the array
    public byte[] bytes()      { return bytes; }           // wrong — caller can mutate it
}
```

A `byte[]` is a mutable object. The fix is two `clone()` calls: one in the constructor, one in the accessor (see section 8 above).

**Mistake 3: deep-copying things that don't need it.**

```java
public final class Customer {
    private final String name;
    public Customer(Customer other) { this.name = new String(other.name); }   // pointless
}
```

`String` is immutable. `new String(other.name)` allocates a needless object. Just `this.name = other.name`.

**Mistake 4: shallow-copying a list of mutable elements and thinking it's safe.**

```java
this.lines = new ArrayList<>(other.lines);   // copies the list, NOT the LineItem instances
```

If `LineItem` is mutable, you've created a new list whose elements are still shared with the original. Either make `LineItem` immutable (record), or deep-copy the elements too.

**Mistake 5: assuming records are always the right answer.**

Records are perfect for value carriers. They're not the right shape for entities with identity (a `Customer` with a database-generated id and lifecycle methods) — those want a class with a clear copy strategy and a copy constructor.

---

## 10. Quick rules

- [ ] **Records first.** If the type is a value, make it a `record`. No copy needed.
- [ ] **Copy constructor or `copyOf` for mutable types.** Pick one idiom and stay consistent.
- [ ] **No `Cloneable` in new code.** Replace it on sight.
- [ ] **Defensive copy at the boundary.** Constructor copies in, accessor copies out, for any mutable field that crosses the class wall.
- [ ] **`List.copyOf` / `Map.copyOf` / `Set.copyOf`** for collection fields — unmodifiable result, zero allocation if input is already safe.
- [ ] **Shallow by default; deep across trust boundaries.** Don't copy what's already immutable.
- [ ] **Arrays are always mutable.** They need explicit `.clone()` or a wrapper to a `List`.

---

## 11. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| Worked refactors from `Cloneable` to copy constructor; deep vs shallow | `middle.md`        |
| `Cloneable` protocol deep dive; cycles; FBCP; persistent structures    | `senior.md`        |
| Team policy, ArchUnit/Sonar rules, IDE traps, migrations               | `professional.md`  |
| JLS §Object.clone, §Cloneable, JEP 395 records                         | `specification.md` |
| 10 buggy snippets across clone/copy idioms                             | `find-bug.md`      |
| Native clone vs constructor; escape analysis; Valhalla flat copies     | `optimize.md`      |
| 8 hands-on copy and defensive-copy exercises                           | `tasks.md`         |
| 20 interview Q&A on clone and copy semantics                           | `interview.md`     |

---

**Memorize this:** *records first, copy constructor or `copyOf` second, `Cloneable` never*. Take a defensive copy at every constructor and accessor that crosses a trust boundary with a mutable value, and don't waste cycles copying what is already immutable. The deepest a junior copy bug usually goes is one missing `.clone()` on a `byte[]` or one missing `List.copyOf` in a constructor — fix those two reflexes and 90% of leaks vanish.
