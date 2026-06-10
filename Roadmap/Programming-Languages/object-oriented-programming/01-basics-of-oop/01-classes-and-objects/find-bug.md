# Classes and Objects — Find the Bug

> 12 buggy snippets, each illustrating a real production-grade mistake around classes and objects. For each: read the code, find the bug, and write down (a) *why* it bites, (b) *when* it bites (always, only in concurrency, only after caching, …), and (c) the fix.

---

## Bug 1 — Equals without hashCode

```java
public final class Money {
    private final long cents;
    private final String currency;

    public Money(long cents, String currency) {
        this.cents = cents;
        this.currency = currency;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Money m)) return false;
        return cents == m.cents && currency.equals(m.currency);
    }
    // hashCode is NOT overridden
}
```

```java
Map<Money, String> notes = new HashMap<>();
notes.put(new Money(100, "USD"), "lunch");
notes.get(new Money(100, "USD"));   // ???
```

**Bug.** `equals` is overridden but `hashCode` is not, so two equal `Money` objects almost always end up in different hash buckets. The `get` returns `null` even though `equals` agrees the keys are equal.

**Fix.** Override `hashCode` consistently:

```java
@Override public int hashCode() { return Objects.hash(cents, currency); }
```

**Lesson.** The contract is non-negotiable. Override both, or neither. Use IDE generation or switch to a `record`.

---

## Bug 2 — Mutable field in `equals`

```java
public class Order {
    private final long id;
    private OrderStatus status;

    public Order(long id, OrderStatus status) { this.id = id; this.status = status; }
    public void setStatus(OrderStatus s) { this.status = s; }

    @Override public boolean equals(Object o) {
        return o instanceof Order other
            && id == other.id
            && status == other.status;
    }
    @Override public int hashCode() { return Objects.hash(id, status); }
}
```

```java
Set<Order> placed = new HashSet<>();
Order o = new Order(1, OrderStatus.DRAFT);
placed.add(o);
o.setStatus(OrderStatus.PLACED);   // mutates the field used in hashCode
placed.contains(o);                // ???
```

**Bug.** `Order` is an entity (has `id`) but `equals`/`hashCode` include a mutable field. After mutation, `o`'s hash changes; the set still holds the entry in the old bucket and `contains(o)` returns `false` — even though the same physical object is *in* the set.

**Fix.** Hash and compare entities by their stable identity only:

```java
@Override public boolean equals(Object o) {
    return o instanceof Order other && id == other.id;
}
@Override public int hashCode() { return Long.hashCode(id); }
```

**Lesson.** Hash on what *cannot change*. Mutable fields and hash codes are oil and water.

---

## Bug 3 — Constructor leaking `this`

```java
public class Listener {
    private final Map<String, Handler> handlers;

    public Listener(EventBus bus) {
        bus.register(this);                       // (1)
        this.handlers = new HashMap<>();          // (2)
    }
}
```

**Bug.** At line (1) `this` is published to the event bus before `handlers` is initialized. If the bus immediately invokes a handler — or another thread sees the registered reference and calls into it — `handlers` is still `null`. Result: NPE under unpredictable timing.

**Fix.** Construct first, register after.

```java
public Listener() {
    this.handlers = new HashMap<>();
}
public void start(EventBus bus) {
    bus.register(this);
}
```

**Lesson.** No external publication of `this` from inside a constructor. Especially never from a constructor that races with other threads.

---

## Bug 4 — Overridable call from constructor

```java
public class Base {
    public Base() {
        init();          // overridable!
    }
    protected void init() { }
}

public class Sub extends Base {
    private final List<String> data = new ArrayList<>();

    @Override
    protected void init() {
        data.add("hello");      // NPE — data isn't constructed yet
    }
}
```

**Bug.** `Base`'s constructor runs *before* `Sub`'s field initializers. By the time `init()` (overridden) runs, `data` is still `null`. Throws NPE.

**Fix.** Don't call overridable methods from a constructor. Make `init` `private` or `final`, or move post-construction work to an explicit method called by the user.

**Lesson.** A subclass observes a half-built parent. Treat constructors as sealed against polymorphism.

---

## Bug 5 — Defensive copy missed on the way in

```java
public final class ImmutableConfig {
    private final List<String> hosts;

    public ImmutableConfig(List<String> hosts) {
        this.hosts = Collections.unmodifiableList(hosts);   // wraps, doesn't copy
    }
    public List<String> hosts() { return hosts; }
}
```

```java
List<String> seed = new ArrayList<>(List.of("h1", "h2"));
ImmutableConfig c = new ImmutableConfig(seed);
seed.add("h3");                            // caller mutates the underlying list
System.out.println(c.hosts());             // [h1, h2, h3]  — config silently changed
```

**Bug.** `Collections.unmodifiableList` is a *view* over the input list. The caller still holds the live reference and can mutate it through the back door.

**Fix.** Copy on the way in:

```java
this.hosts = List.copyOf(hosts);   // Java 10+
```

**Lesson.** Immutability through wrapping ≠ immutability. If your invariant is "this list never changes," you must own a fresh copy.

---

## Bug 6 — Defensive copy missed on the way out

```java
public final class Snapshot {
    private final byte[] data;
    public Snapshot(byte[] data) { this.data = data.clone(); }
    public byte[] data() { return data; }     // returns the live array
}
```

```java
Snapshot s = new Snapshot("abc".getBytes());
s.data()[0] = 'Z';
new String(s.data());            // "Zbc"
```

**Bug.** Copy on the way in, but the getter exposes the internal array. Callers can mutate it directly.

**Fix.** Either return a copy (`return data.clone();`) or expose a read-only view (e.g., `ByteBuffer.wrap(data).asReadOnlyBuffer()`).

**Lesson.** "Defensive copy" means *both* directions for mutable types — arrays and pre-`java.time` collections especially.

---

## Bug 7 — Overload that silently changes meaning

```java
public class Cart {
    public void remove(int index) { items.remove(index); }       // by position
    public void remove(Integer item) { items.remove(item); }     // by value
}

cart.add(7);
cart.remove(0);   // intended: remove first item?
```

**Bug.** `cart.remove(0)` is `int`, dispatched to `remove(int index)` — removes the first item by position. If the developer meant "remove the value 0" they would need `cart.remove(Integer.valueOf(0))`. This is the famous `List.remove(int)` vs `remove(Object)` trap.

**Fix.** Don't overload methods on primitives vs their boxed wrappers. Rename one of them: `removeAt(int index)`, `removeValue(Integer value)`.

**Lesson.** Overloading resolves at compile time on static types. When the static types differ subtly (`int` vs `Integer`), the call you get may not be the call you read.

---

## Bug 8 — Comparing strings with `==`

```java
public boolean isAdmin(User user) {
    return user.role() == "admin";          // ???
}
```

**Bug.** `user.role()` may not return an interned literal. If it returns a `String` built from concatenation, parsed JSON, or `new String(...)`, the `==` is a reference comparison and `false` even when the content is `"admin"`.

**Fix.** Use `equals` (or, since Java 7, `Objects.equals` for null-safety):

```java
return "admin".equals(user.role());
```

Even better, model role as an enum.

**Lesson.** `==` on reference types is reference identity. The string pool is an optimization, not a guarantee — never depend on it.

---

## Bug 9 — Self-referencing static initializer

```java
public class Constants {
    public static final int A = B + 1;
    public static final int B = 10;
}

System.out.println(Constants.A);   // ???
```

**Bug.** Static initializers run in source order. When `A` is being assigned, `B` hasn't been initialized yet — it has its default value `0`. So `A` becomes `1` even though "everyone knows" `B = 10`.

**Fix.** Either reorder the declarations or pull the values into computed expressions/factories. Be explicit.

**Lesson.** Initialization order matters in `<clinit>`. Use `final` plus simple constant expressions, or use an `enum`/`record` to make the relationships explicit.

---

## Bug 10 — Subclassing breaks `equals` symmetry

```java
public class Point {
    final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
    @Override public int hashCode() { return Objects.hash(x, y); }
}

public class ColorPoint extends Point {
    final Color color;
    public ColorPoint(int x, int y, Color c) { super(x, y); this.color = c; }
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColorPoint cp)) return false;
        return super.equals(o) && color.equals(cp.color);
    }
}

Point p     = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, Color.RED);
p.equals(cp)    // true
cp.equals(p)    // false   ← asymmetric!
```

**Bug.** Symmetry is broken. `Point.equals` happily compares against any `Point` (including `ColorPoint`); `ColorPoint.equals` rejects plain `Point`. Hash-based collections become inconsistent.

**Fix.** Make `Point` `final`, or use composition (`ColorPoint` *has-a* `Point`), or use the strict `getClass()` check (`o.getClass() == this.getClass()`) and accept that subclasses are never equal to superclasses.

**Lesson.** `equals` and inheritance don't mix. Value-shaped classes should be `final`.

---

## Bug 11 — Using a non-immutable as a `HashMap` key

```java
class StringList {
    final List<String> values = new ArrayList<>();
    @Override public boolean equals(Object o) { ... }      // delegates to values.equals
    @Override public int hashCode() { return values.hashCode(); }
}

Map<StringList, Integer> map = new HashMap<>();
StringList key = new StringList();
key.values.add("a");
map.put(key, 1);

key.values.add("b");
map.get(key);    // ???
```

**Bug.** The key's hash is based on a mutable field. After mutation, the hash changed, but the entry still sits in the old bucket. `get` looks in a different bucket and returns `null` — even though `key` *is* the original key.

**Fix.** Make the key effectively immutable. Either freeze it (defensive copy + `final` field) or use a different key type. Use `List.copyOf` if you need a list-shaped key.

**Lesson.** *Map keys must be immutable in their hash-relevant fields.* This is the same invariant as Bug 2, just from a different angle.

---

## Bug 12 — `clone()` does the shallow thing

```java
public class Group implements Cloneable {
    List<User> users = new ArrayList<>();

    @Override
    public Group clone() {
        try {
            return (Group) super.clone();    // shallow copy
        } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}

Group g1 = new Group();
g1.users.add(new User("Alice"));

Group g2 = g1.clone();
g2.users.add(new User("Bob"));   // also visible from g1!
g1.users.size();                  // 2
```

**Bug.** `Object.clone()` does a shallow field-by-field copy. The `users` reference is shared between `g1` and `g2`. Mutating one's list mutates the other.

**Fix.** Either (a) implement a deep `clone` that copies the list and each user, or (b) — much better — drop `Cloneable` entirely and use a *copy constructor* or a static factory:

```java
public Group(Group source) {
    this.users = source.users.stream().map(User::new).toList();
}
```

**Lesson.** `Cloneable` is a broken contract (Effective Item 13). Use copy constructors, factory methods, or — for values — immutability that makes copying unnecessary.

---

## Pattern summary

| Bug type                                    | What to look for                              |
|---------------------------------------------|-----------------------------------------------|
| Equality contract violations (Bugs 1, 2, 11)| `equals` without `hashCode`; mutable fields in `equals` |
| Constructor pitfalls (Bugs 3, 4)            | Leaking `this`; calling overridable methods   |
| Defensive-copy gaps (Bugs 5, 6, 12)         | Storing/returning live mutable references     |
| Reference vs value confusion (Bug 8)        | `==` on `String`, on boxed numbers            |
| Inheritance hazards (Bug 10)                | `equals` + non-final superclass               |
| Resolution surprises (Bugs 7, 9)            | Overloads on primitive vs boxed; init order   |

These are the most common production failure modes for "ordinary" classes. Almost every one is covered by either a static analyzer (Error Prone, SpotBugs, IntelliJ inspections) or a code-review heuristic — but only if you know to look.
