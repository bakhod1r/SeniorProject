# Clone and Copy Semantics — Find the Bug

> 10 buggy snippets, each illustrating a silent copy or clone bug that compiles, looks fine in review, and only bites in production, under concurrency, or when the next reasonable feature is added. For each: read the code, identify the failure mode, name the runtime symptom (wrong value, infinite recursion, `ClassCastException`, shared mutation, leaked state), and write down the fix.

---

## Bug 1 — `clone()` that doesn't call `super.clone()`

```java
public class Customer implements Cloneable {
    private long id;
    private String name;
    private Address address;

    @Override
    public Customer clone() {
        Customer c = new Customer();           // wrong — does NOT call super.clone()
        c.id      = this.id;
        c.name    = this.name;
        c.address = new Address(this.address);
        return c;
    }
}

public class PremiumCustomer extends Customer {
    private List<Voucher> vouchers = new ArrayList<>();
    @Override public PremiumCustomer clone() {
        PremiumCustomer c = (PremiumCustomer) super.clone();    // ClassCastException at runtime
        c.vouchers = new ArrayList<>(this.vouchers);
        return c;
    }
}
```

```java
PremiumCustomer p = new PremiumCustomer();
PremiumCustomer q = p.clone();   // BOOM
```

**Symptom.**

```
Exception in thread "main" java.lang.ClassCastException:
    class com.acme.Customer cannot be cast to class com.acme.PremiumCustomer
    at com.acme.PremiumCustomer.clone(PremiumCustomer.java:5)
```

**Violation.** `Customer.clone()` returns a fresh `new Customer()` rather than chaining to `super.clone()`. `super.clone()` from a `PremiumCustomer` would normally return a `PremiumCustomer` (the JVM allocates an instance of the *runtime* class of the receiver). Replacing the chain with `new Customer()` hard-codes the type, breaking the subclass path. This is the canonical reason the `Cloneable` protocol requires *every* level to call `super.clone()`.

**Fix.** Either delete `Cloneable` and use copy constructors (preferred):

```java
public Customer(Customer other) {
    this.id      = other.id;
    this.name    = other.name;
    this.address = new Address(other.address);
}
public PremiumCustomer(PremiumCustomer other) {
    super(other);
    this.vouchers = new ArrayList<>(other.vouchers);
}
```

Or — if you must keep `Cloneable` — make `Customer.clone()` chain correctly:

```java
@Override
public Customer clone() {
    try {
        Customer c = (Customer) super.clone();          // returns the runtime type
        c.address = new Address(this.address);
        return c;
    } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
}
```

The copy-constructor route avoids the protocol entirely.

---

## Bug 2 — Shallow copy of a mutable array field

```java
public final class AccessToken {
    private final byte[] bytes;
    private final Instant issuedAt;

    public AccessToken(byte[] bytes, Instant issuedAt) {
        this.bytes    = bytes;             // leak inward
        this.issuedAt = issuedAt;
    }

    public byte[] bytes() {
        return bytes;                      // leak outward
    }
}
```

```java
byte[] secret = new byte[]{1, 2, 3, 4};
AccessToken t = new AccessToken(secret, Instant.now());

secret[0] = 0;                              // the token's bytes silently change

byte[] leaked = t.bytes();
leaked[1] = 0;                              // mutating the accessor result also corrupts the token
```

**Symptom.** No exception. Two days after deployment, a customer-support ticket reads: *"Half the access tokens issued before 14:00 are being rejected by the auth service. The bytes don't match the issued value."* Investigation finds a logger that was helpfully `array[0] = 0`'ing the trailing null after `String` decoding. The mutation reached every `AccessToken` issued in the same minute.

**Violation.** A `byte[]` is *always mutable*. Storing the caller's array reference and returning it from the accessor exposes the internal state in both directions. SpotBugs `EI_EXPOSE_REP` and `EI_EXPOSE_REP2` flag this pattern.

**Fix.** Defensive copy on both sides:

```java
public AccessToken(byte[] bytes, Instant issuedAt) {
    this.bytes    = bytes.clone();
    this.issuedAt = issuedAt;
}

public byte[] bytes() {
    return bytes.clone();
}
```

Or — better — wrap once and never expose the array:

```java
public final class AccessToken {
    private final ByteBuffer view;
    private final Instant issuedAt;

    public AccessToken(byte[] bytes, Instant issuedAt) {
        this.view     = ByteBuffer.wrap(bytes.clone()).asReadOnlyBuffer();
        this.issuedAt = issuedAt;
    }
    public ByteBuffer view() { return view.duplicate(); }
}
```

`ByteBuffer.asReadOnlyBuffer` enforces "no writes" at the type level. Callers cannot mutate even if they try.

---

## Bug 3 — Implementing `Cloneable` on an immutable record (waste)

```java
public record Address(String city, String street) implements Cloneable {

    @Override
    public Address clone() {
        try { return (Address) super.clone(); }
        catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

```java
Address a = new Address("Andijon", "Bukhara St 1");
Address b = a.clone();                   // works, but is pointless
assert a.equals(b);                      // true
assert a != b;                           // two distinct instances
```

**Symptom.** No bug per se — just wasted allocation. A profiler shows `Address` allocations are 2× what they should be. The team is paying for a clone of an immutable type that callers should be reusing by reference.

**Violation.** Records are immutable by spec. There is no defensive reason to copy them. `clone()` on a record produces a distinct instance with the same field values — the only thing it changes is *identity*, and the record's `equals` is identity-blind. The clone is wasted work.

**Fix.** Delete `Cloneable` from the record. Callers that wrote `a.clone()` rewrite to just `a` — the original record is safe to share.

```java
public record Address(String city, String street) {}
```

If a variant of the address is needed, use a wither pattern instead of `clone()`:

```java
public Address withStreet(String s) { return new Address(city, s); }
```

The general rule: records do not need `Cloneable`. The compiler does not generate it; you should not add it.

---

## Bug 4 — Cycle in the graph causes infinite recursion

```java
public final class Customer {
    final String name;
    final List<Order> orders = new ArrayList<>();
    public Customer(String name) { this.name = name; }

    public Customer deepCopy() {
        Customer c = new Customer(this.name);
        for (Order o : this.orders) {
            c.orders.add(o.deepCopy());          // walks back to customer
        }
        return c;
    }
}

public final class Order {
    final long id;
    final Customer customer;
    public Order(long id, Customer customer) {
        this.id = id;
        this.customer = customer;
    }

    public Order deepCopy() {
        return new Order(this.id, this.customer.deepCopy());   // walks back to orders
    }
}
```

```java
Customer alice = new Customer("Alice");
alice.orders.add(new Order(1, alice));
Customer copy = alice.deepCopy();              // BOOM
```

**Symptom.**

```
Exception in thread "main" java.lang.StackOverflowError
    at com.acme.Order.deepCopy(Order.java:9)
    at com.acme.Customer.deepCopy(Customer.java:8)
    at com.acme.Order.deepCopy(Order.java:9)
    at com.acme.Customer.deepCopy(Customer.java:8)
    ...
```

**Violation.** The graph has a cycle (Customer ↔ Order back-references), and the naive deep copy doesn't track which originals it has already copied. Each `deepCopy()` call descends into the back-reference, which descends back, forever.

**Fix.** Pass an `IdentityHashMap<Object, Object>` of "already copied" through the recursion:

```java
public Customer deepCopy() { return deepCopy(new IdentityHashMap<>()); }

Customer deepCopy(Map<Object, Object> seen) {
    Customer existing = (Customer) seen.get(this);
    if (existing != null) return existing;
    Customer copy = new Customer(this.name);
    seen.put(this, copy);
    for (Order o : this.orders) copy.orders.add(o.deepCopy(seen));
    return copy;
}
```

`Order.deepCopy(seen)` does the same trick: check `seen`, install the new instance, then recurse. The second time the walk reaches a customer it has already copied, it returns the existing copy and unwinds. `IdentityHashMap` (not `HashMap`) is required because we're tracking by identity, not by equals.

A better long-term fix: redesign so the cycle doesn't exist. An `Order` doesn't need a back-reference to its `Customer` if the call sites that have an `Order` always have the `Customer` too (or can look it up by id).

---

## Bug 5 — `Cloneable` subclass forgetting its own field

```java
public class Person implements Cloneable {
    private String name;
    private List<String> aliases;

    @Override
    public Person clone() {
        try {
            Person c = (Person) super.clone();
            c.aliases = new ArrayList<>(this.aliases);
            return c;
        } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}

public class Employee extends Person {
    private List<Skill> skills = new ArrayList<>();

    @Override
    public Employee clone() {
        return (Employee) super.clone();                  // FORGOT to copy skills
    }
}
```

```java
Employee alice = new Employee();
alice.addSkill(new Skill("Java"));
Employee bob = alice.clone();
bob.addSkill(new Skill("Kotlin"));
assert alice.skills.size() == 1;     // FAILS — alice now has 2 skills
```

**Symptom.** Two employees share the same `skills` list. A new employee added to the team via `clone()` inherits skill changes the original makes later, and vice versa. Discovered when an HR report shows every employee on the team has identical skill lists.

**Violation.** The `Cloneable` protocol requires every subclass to deep-copy *its own* mutable fields after `super.clone()`. `Employee.clone()` calls `super.clone()` (which deep-copies the *parent's* `aliases` correctly), but then forgets to copy `skills`. The classic Fragile Base Class symptom — the parent did its work, and the subclass author's mistake silently breaks the contract.

**Fix.** Add the missing line:

```java
@Override
public Employee clone() {
    Employee c = (Employee) super.clone();
    c.skills = new ArrayList<>(this.skills);
    return c;
}
```

Better: ditch `Cloneable` and use copy constructors, where the subclass author's responsibility is mechanically obvious from reading the constructor body:

```java
public Employee(Employee other) {
    super(other);
    this.skills = new ArrayList<>(other.skills);
}
```

The copy constructor has the *same* missing-line risk, but reviewers see it immediately because the constructor lists every field. With `Cloneable`, the missing copy is invisible — the `super.clone()` line hides what's actually happening.

---

## Bug 6 — `clone()` returning the parent type instead of self (no covariant return)

```java
public class Order implements Cloneable {

    @Override
    public Object clone() throws CloneNotSupportedException {     // returns Object
        return super.clone();
    }
}
```

```java
Order o = new Order();
Order c = o.clone();              // compile error: required Order, found Object
Order c = (Order) o.clone();      // forced cast at every call site
```

**Symptom.** Every caller of `clone()` casts. Static analysis flags `BC_UNCONFIRMED_CAST` everywhere. New callers copy-paste the cast, including the wrong one — eventually someone writes `(OrderLine) o.clone()` for an `Order` and it compiles, then `ClassCastException` at runtime.

**Violation.** `Object.clone()` returns `Object`. JLS §8.4.5 (covariant return) lets a subclass declare a more specific return — *but you have to remember to use it*. Forgetting the covariant declaration leaves callers casting forever.

**Fix.** Declare the return type as `Order`:

```java
@Override
public Order clone() {
    try {
        return (Order) super.clone();
    } catch (CloneNotSupportedException impossible) {
        throw new AssertionError(impossible);
    }
}
```

Now callers write `Order c = o.clone();` cleanly. The cast moves to one place — inside the override — where it's correct by construction.

Better: don't use `clone()` at all. A copy constructor or `copyOf` factory has the right return type without ceremony:

```java
Order c = new Order(o);
Order c = Order.copyOf(o);
```

Neither requires a cast and neither uses the `Cloneable` machinery.

---

## Bug 7 — `clone()` with thread-unsafe initialization

```java
public class Cache implements Cloneable {
    private final ConcurrentHashMap<String, byte[]> store = new ConcurrentHashMap<>();
    private final AtomicLong hits = new AtomicLong();
    private final long createdAt;

    public Cache() {
        this.createdAt = System.currentTimeMillis();
        Registry.register(this);                 // side effect: registers in a global cache directory
    }

    @Override
    public Cache clone() {
        try {
            Cache c = (Cache) super.clone();
            return c;
        } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

```java
Cache primary = new Cache();
Cache shadow = primary.clone();           // shares the store, never registered in Registry
```

**Symptom.** Two failures.

1. `shadow` shares `primary`'s `store` and `hits`. Writes to `shadow` appear in `primary` and vice versa. Tests that "have their own cache" silently share state.
2. `shadow` was never registered with `Registry`. The directory shows only `primary`. Code that walks `Registry.all()` and clears caches sees one cache and clears it; `shadow` keeps serving stale data.

**Violation.** Two layered. **First**, `Object.clone()` performs a shallow `memcpy`, so `store` and `hits` are shared between primary and shadow even though both are "thread-safe" objects (their thread-safety doesn't help if the *reference* is shared). **Second**, the constructor's side effect (`Registry.register`) does not run for the clone, so the registry-as-source-of-truth invariant breaks silently.

**Fix.** Either deep-copy the collaborators in `clone()` and re-register:

```java
Cache c = (Cache) super.clone();
c.store = new ConcurrentHashMap<>(this.store);    // requires dropping final on store
c.hits  = new AtomicLong(this.hits.get());        // same
Registry.register(c);
return c;
```

— which is ugly, requires dropping `final`, and is full of subtle bugs (the new map is a snapshot, not a live copy; concurrent writers see different things).

Or — properly — drop `Cloneable` entirely and provide a `snapshot()` method whose semantics are explicit:

```java
public Cache snapshot() {
    Cache s = new Cache();        // runs the constructor, registers, sets createdAt
    s.store.putAll(this.store);   // explicit snapshot semantics
    return s;
}
```

The snapshot has *its own* registry entry and *its own* createdAt. Callers know what they're getting. `clone()`'s implicit semantics fooled them; an explicit `snapshot()` doesn't.

---

## Bug 8 — `clone()` leaks via the constructor escape

```java
public class Subscription implements Cloneable {
    private final List<Listener> listeners = new ArrayList<>();
    public Subscription() {
        Broker.subscribe(this);              // 'this' escapes during construction
    }

    @Override
    public Subscription clone() {
        try {
            return (Subscription) super.clone();      // bypasses constructor
        } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

```java
Subscription primary = new Subscription();
Subscription shadow  = primary.clone();
Broker.fire(new Event("x"));                 // delivered to primary AND shadow's shared listeners
shadow.listeners.add(new LoggingListener());
Broker.fire(new Event("y"));                 // ALSO delivered via primary because the list is shared
```

**Symptom.** Listeners attached to `shadow` fire when events arrive at `primary`, and the broker delivers each event twice because two `Subscription` instances are registered for the same listener set. Subscribers see duplicated callbacks; a memory leak ensues as `shadow`s pile up unregistered in the broker.

**Violation.** Two parts. **Shared listener list:** `super.clone()` does a shallow copy, so `shadow.listeners` and `primary.listeners` are the same `ArrayList`. **Constructor side effect skipped:** `Broker.subscribe(this)` runs only once (on `primary`), so `shadow` is not registered in the broker — but events fired *through* `primary` reach `shadow.listeners` anyway because of the shared list. Worst of both worlds.

**Fix.** Make `Subscription` non-cloneable, and copy via a method that goes through the constructor:

```java
public final class Subscription {
    private final List<Listener> listeners = new ArrayList<>();
    public Subscription() { Broker.subscribe(this); }

    public Subscription forkAndSubscribe() {
        Subscription fork = new Subscription();         // runs the constructor, gets its own list, registers
        fork.listeners.addAll(this.listeners);
        return fork;
    }
}
```

The new instance is constructed properly, registered properly, and has its own listener list. The `Cloneable` shortcut produced none of these guarantees.

---

## Bug 9 — Copy constructor doesn't deep-copy a `List` field

```java
public final class Order {
    private final long id;
    private final List<LineItem> lines;
    private OrderStatus status;

    public Order(long id, List<LineItem> lines, OrderStatus status) {
        this.id     = id;
        this.lines  = lines;            // first leak — store caller's list directly
        this.status = status;
    }

    public Order(Order other) {
        this.id     = other.id;
        this.lines  = other.lines;      // second leak — copy doesn't isolate
        this.status = other.status;
    }
}
```

```java
List<LineItem> seedLines = new ArrayList<>(List.of(new LineItem("A", 1)));
Order original = new Order(1L, seedLines, OrderStatus.NEW);
Order copy     = new Order(original);

seedLines.add(new LineItem("B", 2));      // (1) leaks into BOTH original and copy
copy.linesMut().add(new LineItem("C", 3));  // (2) leaks into original
```

**Symptom.** A test that builds a small order, asks for a copy, and mutates the copy fails the original's invariants. A bug ticket reads *"Editing an order in the cart silently edits the order that was already placed."* Discovered when a customer claims their order has items they never ordered — items added by the cart editor *after* the order was placed.

**Violation.** A copy constructor that just reassigns a `List<T>` reference doesn't actually copy. The "copy" shares the same backing list, so mutations on either side reach the other. Worse, the *constructor* of `Order` also stored the caller's list without copying — so even before any "copy", the encapsulation was leaking.

**Fix.** Defensive copy at both entry points:

```java
public Order(long id, List<LineItem> lines, OrderStatus status) {
    this.id     = id;
    this.lines  = List.copyOf(lines);           // unmodifiable snapshot at the boundary
    this.status = status;
}

public Order(Order other) {
    this(other.id, other.lines, other.status);  // 'lines' is already unmodifiable — copyOf returns it as-is
}
```

`List.copyOf` returns an unmodifiable list that the caller cannot mutate. The original constructor's defensive copy means even passing in an `ArrayList` is safe; the copy constructor delegates to the original, so it inherits the same safety. Two leaks closed in two lines.

---

## Bug 10 — `Map.copyOf` vs `new HashMap<>(map)` — a subtle difference

```java
public final class FeatureFlags {
    private final Map<String, Boolean> flags;

    public FeatureFlags(Map<String, Boolean> flags) {
        this.flags = new HashMap<>(flags);    // mutable copy — caller cannot affect
    }

    public Map<String, Boolean> flags() {
        return flags;                         // returns the MUTABLE map
    }

    public boolean isEnabled(String key) {
        return flags.getOrDefault(key, false);
    }
}
```

```java
Map<String, Boolean> seed = Map.of("dark-mode", true);
FeatureFlags ff = new FeatureFlags(seed);

// (1) Test "isolation" is fine for the inbound side:
seed.getClass();                              // Map.of map; caller can't mutate it anyway

// (2) But the OUTBOUND side leaks:
ff.flags().put("dark-mode", false);           // mutates the FeatureFlags's internal map
assert ff.isEnabled("dark-mode") == true;     // FAILS — the value is now false
```

**Symptom.** A feature-flag check that should return `true` returns `false` after some unrelated method called `.flags().put(...)` somewhere in the codebase. The mutation is on an internal map of a value the team thought was immutable. The bug class is hard to find because the mutation site is far from the read site.

**Violation.** The inbound defensive copy was correct (`new HashMap<>(flags)`), but the outbound accessor returned the *mutable* map directly. Half of defensive copying isn't defensive at all — both directions matter.

A separate dimension of this bug: the choice between `new HashMap<>(map)` and `Map.copyOf(map)`.

| Idiom                          | Mutability of result | Allocation on already-immutable input  | Null elements tolerated |
|--------------------------------|----------------------|----------------------------------------|-------------------------|
| `new HashMap<>(map)`           | mutable              | always allocates new map               | yes                     |
| `Map.copyOf(map)`              | unmodifiable         | may return input if already `Map.of`-like | no (NPE on null key/value) |
| `Collections.unmodifiableMap(new HashMap<>(map))` | unmodifiable view of a fresh mutable map | always allocates | yes |

If the goal is "the caller cannot mutate my internal map ever, in either direction", **`Map.copyOf` is the right choice** — it produces an unmodifiable result that you can safely return directly from the accessor. If the goal is "I need to mutate this map later inside my class but isolate it from the caller", **`new HashMap<>(map)` is the right choice** for the constructor — and the accessor must wrap in `Collections.unmodifiableMap` or expose a different shape.

**Fix.** Pick one shape and apply it consistently:

```java
public final class FeatureFlags {
    private final Map<String, Boolean> flags;

    public FeatureFlags(Map<String, Boolean> flags) {
        this.flags = Map.copyOf(flags);        // unmodifiable copy on the way in
    }

    public Map<String, Boolean> flags() {
        return flags;                          // already unmodifiable — safe to return
    }
}
```

`Map.copyOf` plus a directly-returnable accessor closes both leaks. The class now controls its internal state completely; mutating the input map after construction has no effect, and `ff.flags().put(...)` throws `UnsupportedOperationException`.

---

## Pattern summary

| Bug type                                              | What to look for                                                                  |
|-------------------------------------------------------|-----------------------------------------------------------------------------------|
| Clone protocol failure (Bugs 1, 5, 6, 7, 8)           | `clone()` not calling `super.clone()`; missing covariant return; forgotten subclass field; constructor side effects bypassed |
| Shallow array / mutable field leak (Bugs 2, 9)        | Constructor stores caller's array/list directly; accessor returns the same reference |
| Pointless copy on immutable types (Bug 3)             | `Cloneable` on records; `new String(s)`; `Instant.from(other.instant)`            |
| Infinite recursion in deep copy (Bug 4)               | Object graph with back-references and a `deepCopy()` method without identity tracking |
| Inbound vs outbound asymmetry (Bug 10)                | `new HashMap<>(map)` in constructor, raw return in accessor; or `Map.copyOf` only on one side |

These bugs share a feature: the compiler doesn't complain. SpotBugs (`EI_EXPOSE_REP*`, `CN_IDIOM*`) catches half of them; the other half rely on reviewer attention. The senior tax is paid in *diagnosis time* — most of these bugs surface days or weeks after the line of code was written, in code that wasn't on the diff. Build the discipline to spot them at the source.
