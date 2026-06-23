# Clone and Copy Semantics — Practice Tasks

Eight exercises that force each copy idiom — `Cloneable`, copy constructor, `copyOf`, record reuse, defensive copy at boundaries — to bite on realistic domains: orders, addresses, customers, audit logs, trees, graphs, class hierarchies, and immutable redesigns.

Work each task in three passes: (1) read the snippet and name the copy bug or design hole, (2) sketch the new shape on paper before touching the keyboard, (3) write the code and a test that would have caught the original problem.

---

## Task 1 — Replace `Cloneable` with a copy constructor

```java
public class Address implements Cloneable {
    private String city;
    private String street;
    private String zip;

    public Address(String city, String street, String zip) {
        this.city = city; this.street = street; this.zip = zip;
    }

    @Override
    public Address clone() {
        try {
            return (Address) super.clone();
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }

    // setters for city, street, zip ...
}

public class Customer implements Cloneable {
    private long id;
    private String name;
    private Address address;
    private List<String> tags;

    @Override
    public Customer clone() {
        try {
            Customer c = (Customer) super.clone();
            c.address = this.address.clone();
            c.tags    = new ArrayList<>(this.tags);
            return c;
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

**Objective.** Remove `Cloneable` from both classes. Replace `clone()` with copy constructors that produce semantically equivalent results.

**Constraints.**
- Both classes become `final` after the refactor.
- The copy constructor must take a defensive copy of every mutable field (`address`, `tags`).
- Caller code that read `customer.clone()` is rewritten to `new Customer(customer)`.
- No `try`/`catch` for `CloneNotSupportedException` survives.

**Acceptance criteria.**
- Compiling the codebase shows zero references to `Cloneable` and zero `clone()` methods.
- A unit test creates a `Customer`, copies it, mutates the original's `tags` list, and asserts the copy is unchanged.
- A second test mutates the copy's `address` and asserts the original is unchanged.
- The IDE's "Generate clone()" wizard is *not* used at any point.

---

## Task 2 — Implement deep copy for a tree of nodes

```java
public final class TreeNode {
    private String label;
    private final List<TreeNode> children = new ArrayList<>();
    private Map<String, String> attributes = new HashMap<>();

    public TreeNode(String label) { this.label = label; }
    public void addChild(TreeNode c) { children.add(c); }
    public void setAttribute(String k, String v) { attributes.put(k, v); }

    // Bug: returns a SHALLOW copy — children and attributes are shared.
    public TreeNode copy() {
        TreeNode c = new TreeNode(this.label);
        c.children.addAll(this.children);
        c.attributes.putAll(this.attributes);
        return c;
    }
}
```

The tree is used in a templating engine that builds a render tree from a source template, then *deep-copies* it per request to fill in request-specific attributes without polluting the template.

**Objective.** Rewrite `copy()` to produce a true deep copy — every node is fresh, every child list is fresh, every attribute map is fresh. Subtree references must not be shared.

**Constraints.**
- The signature stays `public TreeNode copy()`.
- The depth of the tree is unbounded; use recursion or iteration as you prefer, but explain the choice.
- Cycles cannot occur in this tree (the tree is acyclic by construction); your code may assume so but should document the assumption.

**Acceptance criteria.**
- A test builds a 3-level tree, copies it, mutates the copy's root label and the leaf's attribute map, and asserts the original is unchanged at both levels.
- A second test mutates the *original* after copying and asserts the copy's children list and attributes are unchanged.
- A 1000-node tree copies in under 5 ms on commodity hardware (informal benchmark).
- The copy method is the *only* place where deep-copy logic lives; callers never write `new HashMap<>(node.attrs)` themselves.

---

## Task 3 — Convert mutable `Order` to a record + reuse

```java
public final class Order {
    private long id;
    private String customer;
    private OrderStatus status;
    private final List<LineItem> lines = new ArrayList<>();

    public Order(long id, String customer) {
        this.id = id; this.customer = customer; this.status = OrderStatus.NEW;
    }

    public long id() { return id; }
    public String customer() { return customer; }
    public OrderStatus status() { return status; }
    public List<LineItem> lines() { return lines; }

    public void setStatus(OrderStatus s) { this.status = s; }
    public void addLine(LineItem l) { this.lines.add(l); }
}
```

The order is used in a workflow that creates an order, adds line items, then transitions through statuses. Every "state change" today is a setter call. The team has noticed two bugs in production: (a) one thread sees `OrderStatus.SHIPPED` while another still sees `NEW`, and (b) audit rows for "order at time T" contain the *current* state of `lines`, not the state at time T.

**Objective.** Convert `Order` to a record. Replace setters with `with...` accessors that return new immutable instances. Make the audit log store a record snapshot rather than a live reference.

**Constraints.**
- `Order` becomes a record. `LineItem` is assumed already a record.
- The compact constructor takes a defensive copy of `lines` and rejects null components.
- `withStatus` and `withAddedLine` are the only "mutation" idioms; they return new `Order` instances.
- Callers that previously held a long-lived `Order` reference and called setters are rewritten to *replace* the reference with the result of `with...`.

**Acceptance criteria.**
- A unit test runs `Order o = ...; Order shipped = o.withStatus(SHIPPED);` and asserts `o.status() == NEW` and `shipped.status() == SHIPPED`.
- The audit log row stores the `Order` reference directly; a follow-up `withStatus` on the same id does not mutate the row.
- Concurrency: two threads each `withStatus` from a shared base produce two distinct results; neither is corrupted.
- The `lines` field on the record cannot be mutated by any caller (compile-time guarantee via `List.copyOf`).

---

## Task 4 — Fix the shallow array copy

```java
public final class CryptoKey {
    private final byte[] material;
    private final String algorithm;
    private final Instant issuedAt;

    public CryptoKey(byte[] material, String algorithm, Instant issuedAt) {
        this.material  = material;
        this.algorithm = algorithm;
        this.issuedAt  = issuedAt;
    }

    public byte[] material() { return material; }
    public String algorithm() { return algorithm; }
    public Instant issuedAt() { return issuedAt; }
}
```

The key is stored in a secrets vault. A bug report reads: *"After running our key-rotation job, half the keys in the vault are zeroes."* The job zeros out the *input* byte array as a security hygiene step *after* calling `new CryptoKey(material, alg, issuedAt)`.

**Objective.** Fix both the inbound and outbound leak. Make `CryptoKey` truly own its key material.

**Constraints.**
- The constructor signature must remain `(byte[], String, Instant)`.
- The accessor `material()` must continue to return a `byte[]` (downstream code calls `Cipher.update(...)` with it). You cannot change the type.
- Document the defensive-copy contract on both methods.
- Bonus: provide an alternative accessor `materialView()` returning a `ByteBuffer.asReadOnlyBuffer()` to discourage callers from needing the array at all.

**Acceptance criteria.**
- A test zeros out the constructor's input array after construction and asserts the key's material is unaffected.
- A second test mutates the accessor's return value and asserts the key's material is unaffected.
- A third test uses `materialView()`, attempts to write to it, and confirms `ReadOnlyBufferException` is thrown.
- The class is `final` and all three fields are `private final`.

---

## Task 5 — Defensive copy at the boundaries

```java
public final class Reservation {
    private long id;
    private LocalDate from;
    private LocalDate to;
    private List<Long> attendees;
    private byte[] signature;
    private Map<String, String> metadata;

    public Reservation(long id, LocalDate from, LocalDate to,
                       List<Long> attendees, byte[] signature,
                       Map<String, String> metadata) {
        this.id        = id;
        this.from      = from;
        this.to        = to;
        this.attendees = attendees;
        this.signature = signature;
        this.metadata  = metadata;
    }

    public List<Long> attendees() { return attendees; }
    public byte[] signature()     { return signature; }
    public Map<String, String> metadata() { return metadata; }
    // ... id, from, to accessors
}
```

A bulk-import job builds 10 000 `Reservation` objects from CSV rows, mutating the same backing `ArrayList<Long>` and `HashMap<String, String>` it reuses across rows. The result: every reservation in the database refers to the *last row's* attendees and metadata.

**Objective.** Make `Reservation` immune to caller-side mutation at every boundary — constructor in, accessors out. Cover all six fields by their mutability class.

**Constraints.**
- Use the per-field conversion table from `middle.md` section 11.
- `LocalDate` is immutable; do not waste an allocation on it.
- `byte[]` is mutable; clone on both sides, handle the null case.
- `List<Long>` and `Map<String, String>` use `List.copyOf` / `Map.copyOf`.
- All fields become `final`; the class becomes `final`.

**Acceptance criteria.**
- The constructor takes defensive copies for all mutable fields; the accessors do too (where the field type is mutable).
- A test runs the bulk-import scenario: build N reservations from a reused `ArrayList`/`HashMap`/`byte[]`, then mutate the inputs. Every reservation's fields remain at the values they had at construction.
- A second test mutates each accessor's return value and asserts the reservation is unaffected.
- The string `clone()` appears at most twice in the class — once in the constructor for `signature`, once in the accessor for `signature`.

---

## Task 6 — Make a graph clone handle cycles

```java
public final class Person {
    final String name;
    final List<Person> friends = new ArrayList<>();
    public Person(String name) { this.name = name; }

    public Person deepCopy() {
        Person p = new Person(this.name);
        for (Person f : this.friends) p.friends.add(f.deepCopy());
        return p;
    }
}
```

A social-graph visualisation tool calls `root.deepCopy()` before rendering, to detach the in-memory graph from the live data store. Today it crashes:

```
java.lang.StackOverflowError
    at com.acme.Person.deepCopy(Person.java:7)
    ...
```

— because the graph has cycles (Alice is in Bob's friends, Bob is in Alice's friends).

**Objective.** Make `deepCopy()` handle cycles correctly. Two people who are mutual friends in the original must also be mutual friends in the copy (and `==` to each other across the copy).

**Constraints.**
- Track already-copied nodes in an `IdentityHashMap<Person, Person>` passed through the recursion.
- The public method stays `public Person deepCopy()`; the recursive helper is private.
- The mapping is built *before* recursing into a node's friends — otherwise the recursion still loops.

**Acceptance criteria.**
- A test builds a 2-node mutual-friendship graph (`alice.friends = [bob]`, `bob.friends = [alice]`), calls `alice.deepCopy()`, and asserts: (a) the result's `friends.get(0)` is the bob-copy, (b) the bob-copy's `friends.get(0)` is the result itself (i.e., the cycle is preserved with the *new* identities).
- A test builds a 100-node random graph with arbitrary cycles and verifies `deepCopy()` returns without `StackOverflowError`.
- The `seen` map uses `IdentityHashMap`, not `HashMap` (justify why in a comment).
- No `Person` from the original ever appears in the copy.

---

## Task 7 — Implement `copyOf` factory for a class hierarchy

```java
public abstract class Vehicle {
    protected final String licensePlate;
    protected final int seats;
    protected Vehicle(String licensePlate, int seats) {
        this.licensePlate = licensePlate;
        this.seats        = seats;
    }
    public abstract Vehicle copyOf();        // covariant override per subclass
}

public final class Car extends Vehicle {
    private final boolean hasSunroof;
    public Car(String lp, int seats, boolean sunroof) { super(lp, seats); this.hasSunroof = sunroof; }
    @Override public Car copyOf() { /* TODO */ }
}

public final class Truck extends Vehicle {
    private final int cargoCapacityKg;
    public Truck(String lp, int seats, int cargoKg) { super(lp, seats); this.cargoCapacityKg = cargoKg; }
    @Override public Truck copyOf() { /* TODO */ }
}
```

The fleet management system calls `vehicle.copyOf()` polymorphically — given a `Vehicle`, get back a `Vehicle` of the same concrete type, copied field-by-field.

**Objective.** Implement `copyOf()` correctly on both subclasses *without* using `Cloneable`. Combine with copy constructors so the implementations are short and obviously correct.

**Constraints.**
- Add a protected copy constructor on `Vehicle` that subclasses can chain into.
- Each subclass's `copyOf()` calls its own copy constructor.
- The return type of each `copyOf()` is the subclass's own type (covariant return).
- A bus or motorcycle added tomorrow follows the same template.

**Acceptance criteria.**
- `Car c1 = ...; Vehicle v = c1; Car c2 = (Car) v.copyOf();` works, and `c2.getClass() == Car.class`.
- A test loops over a `List<Vehicle>` of mixed types and `copyOf()`s each; asserts the copied list has matching concrete types per index.
- No `Cloneable` anywhere; no `super.clone()`; no `CloneNotSupportedException` caught.
- A new `Motorcycle extends Vehicle` is added in a separate file and follows the template; the test loop still works without edits.

---

## Task 8 — Switch from clone-based defensive copy to immutable + share

```java
public final class CustomerSnapshotService {
    private final Map<Long, Customer> customers;        // Customer is mutable

    public CustomerSnapshotService(Map<Long, Customer> customers) {
        this.customers = new HashMap<>(customers);
    }

    /** Returns a "safe" snapshot — deep-clones every customer to detach from live state. */
    public List<Customer> snapshot() {
        List<Customer> result = new ArrayList<>();
        for (Customer c : customers.values()) {
            result.add(c.clone());       // 50k customers, each clone deep-copies a few lists
        }
        return result;
    }
}
```

The service is called 100 times per second by a dashboard. Each call deep-clones 50 000 mutable `Customer` objects. The profiler shows 40% of CPU is spent in `clone()`.

**Objective.** Redesign so `snapshot()` returns an *immutable* view that's safe to share without copying. Eliminate the per-call deep-clone walk.

**Constraints.**
- Convert `Customer` to a record (or at least make it deeply immutable: final class, final fields, immutable collections).
- Replace the snapshot machinery with `List.copyOf(customers.values())` — the underlying customers are now safe to share by reference.
- All callers of `snapshot()` continue to work — the API contract is preserved.
- Document the contract change: snapshots are immutable, sharing is the new norm.

**Acceptance criteria.**
- After the refactor, `snapshot()` allocates one `List` (with N references) instead of N deep-cloned `Customer` instances. JMH or `-prof gc` confirms the allocation reduction.
- A test mutates the underlying customer store and asserts that previously-issued snapshots are *not* mutated.
- A second test attempts to mutate the snapshot list itself and confirms `UnsupportedOperationException` is thrown.
- The CPU profile shows `clone()` no longer in the top 10 hot methods.

---

## Validation

| Task | How to verify the fix |
|------|-----------------------|
| 1 | Searching the codebase for `Cloneable` returns zero hits inside `com.acme..`; copy-roundtrip tests pass for both classes. |
| 2 | A test that mutates an attribute on a copied leaf node and asserts the original's leaf is unchanged. |
| 3 | `Order` is a record; `withStatus`/`withAddedLine` produce distinct instances; concurrent threads cannot corrupt state. |
| 4 | Zero-out the input array after construction; the key's material is the original bytes. |
| 5 | Reservations built from reused mutable inputs retain their construction-time field values. |
| 6 | Cyclic graph `deepCopy()` completes without `StackOverflowError` and preserves the cycle topology. |
| 7 | `vehicle.copyOf().getClass() == vehicle.getClass()` for every concrete subtype. |
| 8 | `clone()` disappears from the CPU profile; snapshot allocations drop by orders of magnitude. |

---

## Worked solution sketch — Task 5 (defensive copy at the boundaries)

```java
public final class Reservation {
    private final long id;
    private final LocalDate from;            // immutable — share
    private final LocalDate to;              // immutable — share
    private final List<Long> attendees;      // unmodifiable copy
    private final byte[] signature;          // owned copy; nullable
    private final Map<String, String> metadata;  // unmodifiable copy

    public Reservation(long id, LocalDate from, LocalDate to,
                       List<Long> attendees, byte[] signature,
                       Map<String, String> metadata) {
        if (from.isAfter(to)) throw new IllegalArgumentException("from after to");
        this.id        = id;
        this.from      = Objects.requireNonNull(from);
        this.to        = Objects.requireNonNull(to);
        this.attendees = List.copyOf(attendees);                                   // <-- copyOf
        this.signature = (signature == null) ? null : signature.clone();           // <-- clone
        this.metadata  = Map.copyOf(metadata);                                     // <-- copyOf
    }

    public long id()                    { return id; }
    public LocalDate from()             { return from; }
    public LocalDate to()               { return to; }
    public List<Long> attendees()       { return attendees; }                      // already unmodifiable
    public byte[] signature()           { return signature == null ? null : signature.clone(); }
    public Map<String, String> metadata() { return metadata; }                     // already unmodifiable
}
```

Three things to notice in the sketch:

1. **Per-field judgement.** Every field is treated by its mutability class — primitives and immutables shared, mutable collections via `copyOf`, arrays via `clone()`. No blanket policy; one decision per field.
2. **Null handling.** `signature` is nullable; the constructor and accessor both branch on `null`. Trying to call `null.clone()` would NPE.
3. **The invariant check stays in the constructor.** `from.isAfter(to)` is validated once, before any field is assigned. The record-compact-constructor pattern from `specification.md` section 8 expresses the same idea more compactly if you migrate to a record.

The bulk-import scenario that was breaking before is now safe: even if the calling code reuses an `ArrayList<Long>` across all 10 000 rows, each `Reservation` gets its own unmodifiable snapshot at construction time. The "every reservation refers to the last row" bug class is closed by one line per mutable field.

---

**Memorize this:** every task above has the same shape — *walk the field list, classify each field by mutability, apply the right copy idiom at every boundary that crosses the class wall, and pick records whenever the type can be a value carrier.* If the next plausible bug — a mutation, a shared reference, a snapshot that follows live state — can be answered by pointing at one field's wrong row in the conversion table, the refactor was right.
