# Final Keyword — Find the Bug

> 12 buggy snippets where `final` is involved (or its absence is the bug). Read each, identify why it bites, when it bites, and the fix.

---

## Bug 1 — `final` reference, mutable object

```java
public class Cart {
    public final List<Item> items = new ArrayList<>();
}

Cart c = new Cart();
c.items.add(new Item("hack"));    // ✓ mutates the list
c.items.clear();                   // ✓ wipes everything
```

**Bug.** `final` controls the *reference*, not the object. The list is fully mutable. Any caller can corrupt the cart's state.

**Fix.** Use an immutable list and add via methods:

```java
public final class Cart {
    private final List<Item> items;
    public Cart(List<Item> items) { this.items = List.copyOf(items); }
    public List<Item> items() { return items; }
}
```

Or, if mutable is required, defend the boundary with explicit add/remove methods.

**Lesson.** `final` ≠ deep immutability. Combine with immutable types.

---

## Bug 2 — Constructor escape breaks freeze rule

```java
public final class Listener {
    private final int counter;

    public Listener(EventBus bus) {
        bus.register(this);                 // this escapes!
        this.counter = 42;
    }

    public void onEvent() {
        System.out.println(counter);         // may print 0!
    }
}
```

**Bug.** The constructor publishes `this` *before* setting `counter`. Another thread receiving the registration may invoke `onEvent` while `counter` is still 0 (default).

**Fix.** Don't escape `this`. Defer registration:

```java
public Listener() { this.counter = 42; }
public void start(EventBus bus) { bus.register(this); }
```

**Lesson.** `final` field's freeze guarantee requires the constructor to *finish* before publication. Escape during construction breaks it.

---

## Bug 3 — Reflection mutates a `final` constant

```java
public class Constants {
    public static final int MAX = 100;
}

Field f = Constants.class.getDeclaredField("MAX");
f.setAccessible(true);
f.setInt(null, 999);

System.out.println(Constants.MAX);     // could print 100 — JIT inlined the value
```

**Bug.** Java may have inlined `100` at compile time into reading bytecode. Reflection updates the field, but inlined call sites still see `100`. Reads through fresh code see `999`. Non-deterministic.

**Fix.** Don't mutate `final` fields via reflection. If a value must change, design it as a method or a non-final field protected by `VarHandle`.

**Lesson.** `final` is a contract the JIT relies on. Breaking it via reflection produces undefined behavior.

---

## Bug 4 — Forgetting `final` on a value class breaks equals symmetry

```java
public class Point {
    final int x, y;
    @Override public boolean equals(Object o) {
        return o instanceof Point p && x == p.x && y == p.y;
    }
}

public class ColorPoint extends Point {
    final Color color;
    @Override public boolean equals(Object o) {
        return o instanceof ColorPoint cp && super.equals(o) && color.equals(cp.color);
    }
}

Point p = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, RED);
p.equals(cp);    // true
cp.equals(p);    // false   — broken symmetry
```

**Bug.** `Point.equals` accepts any `Point` (including `ColorPoint`); `ColorPoint.equals` rejects plain `Point`. Symmetry violated. `HashSet.contains`, `HashMap.get` produce wrong results.

**Fix.** Make `Point` `final`. Or use composition (`ColorPoint` *has-a* `Point`). Records are `final` by default, sidestepping this.

**Lesson.** Value classes with overridden `equals` should be `final`.

---

## Bug 5 — Inner class missing `static` keeps outer alive

```java
public class Outer {
    private final byte[] heavyData = new byte[10_000_000];

    public class Builder {                          // ⚠ not static — implicit Outer.this reference
        public Result build() { ... }
    }
}

Outer.Builder b = new Outer().new Builder();
// b silently retains the 10 MB Outer instance forever
```

**Bug.** A non-static inner class holds a reference to its enclosing instance. Even if the outer is logically discardable, the inner keeps it alive — memory leak.

**Fix.** Make the inner class `static`:

```java
public static class Builder { ... }
```

Now `Builder` doesn't hold the outer reference.

**Lesson.** Default to `static` for nested classes. Drop `static` only if you need access to the outer instance (rare for builders, common for some other patterns).

---

## Bug 6 — `final` parameter expecting caller to be affected

```java
public void process(final List<String> input) {
    input.add("x");               // ✓ mutates caller's list
    input = new ArrayList<>();    // ❌ compile error
}
```

**Bug** (or rather, misunderstanding). Some developers think `final` parameter means "caller's variable is also locked." It doesn't. `final` is purely local — it prevents reassignment within this method body. The caller is unaffected.

**Lesson.** `final` on parameters is local hygiene, not a caller contract.

---

## Bug 7 — Field that should be `final` accidentally reassigned

```java
public class Account {
    private long balance;        // missing final
    public Account(long initial) { balance = initial; }

    public void deposit(long amount) {
        balance = balance + amount;     // intentional
    }

    public void withdraw(long amount) {
        balance -= amount;
        if (balance < 0) {
            balance = 0;                 // hidden bug — silently masks the overdraft
        }
    }
}
```

**Bug.** `balance` is mutable (not `final`). The `withdraw` method silently sets it to 0 if it would go negative — masking what should be an exception.

**Fix.** Use exception, not silent correction:

```java
public void withdraw(long amount) {
    if (amount > balance) throw new IllegalStateException("insufficient funds");
    balance -= amount;
}
```

**Lesson.** Not really a `final` bug, but: `final` reasoning forces you to think about state transitions. Mutable fields invite silent corrections that hide bugs.

---

## Bug 8 — `final` and `Cloneable` mismatch

```java
public final class Order implements Cloneable {
    private final List<OrderLine> lines;
    public Order(List<OrderLine> lines) { this.lines = new ArrayList<>(lines); }
    @Override public Order clone() {
        try { return (Order) super.clone(); }
        catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}

Order original = new Order(...);
Order copy = original.clone();
copy.lines.add(...);             // also visible from original!
```

**Bug.** `Object.clone()` does shallow copy. The `lines` field is `final`, but the `ArrayList` reference is shared between the original and the clone. Mutations propagate.

**Fix.** Don't use `Cloneable`. Use a copy constructor:

```java
public Order(Order source) { this.lines = new ArrayList<>(source.lines); }
```

Or — better — make the class fully immutable so cloning is unnecessary.

**Lesson.** `final` doesn't prevent `clone()`'s shallow-copy hazard. Avoid `Cloneable` (Effective Java Item 13).

---

## Bug 9 — `final` field but lazy init violates JMM

```java
public final class LazyValue {
    private final Object lock = new Object();
    private volatile Object value;        // can be initialized late

    public Object get() {
        if (value == null) {
            synchronized (lock) {
                if (value == null) {
                    value = compute();
                }
            }
        }
        return value;
    }
}
```

The `lock` is `final` (good), but `value` cannot be `final` (must be writable).

**Bug** (subtle). The `value` field is `volatile` to ensure visibility. Without `volatile`, double-checked locking is broken (older Java < 5 had a famous bug where readers saw a partially-constructed `value`).

**Fix.** Use `volatile` on `value` (as shown). Or use `Holder`:

```java
private static class Holder { static final Object VALUE = compute(); }
public Object get() { return Holder.VALUE; }
```

**Lesson.** `final` + lazy init don't always mix. Use the holder idiom for lazy `final`-ness, or `volatile` for non-`final` lazy.

---

## Bug 10 — `final` collection field, mutable view returned

```java
public final class Roster {
    private final List<String> names = new ArrayList<>();
    public List<String> names() { return names; }     // ⚠ live reference returned
}

Roster r = new Roster();
r.names().add("Alice");        // bypasses any encapsulation
```

**Bug.** Same family as Bug 1 — the `final` reference doesn't make the list immutable. Returning the live list lets callers mutate it.

**Fix.** Return `List.copyOf(names)` or `Collections.unmodifiableList(names)`:

```java
public List<String> names() { return Collections.unmodifiableList(names); }
```

**Lesson.** Encapsulation requires both `final` and immutable views/copies. One alone is insufficient.

---

## Bug 11 — Static final initialized via mutable input

```java
public class Config {
    public static final List<String> ALLOWED_HOSTS = loadFromEnv();

    private static List<String> loadFromEnv() {
        return new ArrayList<>(...);     // mutable
    }
}

Config.ALLOWED_HOSTS.add("malicious.com");
```

**Bug.** `static final` reference is locked, but the underlying list is mutable. Any caller can pollute the "constant."

**Fix.** Wrap in `List.copyOf` or unmodifiableList:

```java
public static final List<String> ALLOWED_HOSTS = List.copyOf(loadFromEnv());
```

**Lesson.** Same as Bug 1, but at the class level. `static final` of a mutable type is a leaky constant.

---

## Bug 12 — Final variable initialization in branches

```java
public Foo(boolean cond) {
    final int x;
    if (cond) {
        x = 1;
    }
    System.out.println(x);     // ❌ x might not be assigned if cond is false
}
```

**Bug.** Compile error: "variable x might not have been initialized." The compiler's *definite assignment* analysis (JLS §16) requires every code path leading to a use to assign the variable.

**Fix.** Either assign on both branches:

```java
final int x;
if (cond) x = 1; else x = 2;
```

Or use a ternary:

```java
final int x = cond ? 1 : 2;
```

**Lesson.** Definite assignment is one of Java's stricter rules. Use it as a forcing function — if your code can't trivially satisfy it, the design may be unclear.

---

## Pattern summary

| Bug type                                          | Watch for                                            |
|---------------------------------------------------|------------------------------------------------------|
| Final ≠ deep immutability (1, 10, 11)             | `final` field of mutable type; live getter           |
| Constructor escape (2)                            | Publishing `this` before all final fields are set    |
| Reflection mutating final (3)                     | `Field.setAccessible(true)` + JIT inlined value      |
| Equals symmetry (4)                               | Non-final value class with overridden `equals`        |
| Inner class memory leak (5)                       | Forgotten `static` on nested class                    |
| Final parameter misuse (6)                        | Expecting caller-side effect                          |
| Mutable field hiding bugs (7)                     | Non-final state with silent corrections               |
| Cloneable trap (8)                                | Final + Cloneable = shallow copy                      |
| Lazy init breaking JMM (9)                        | Final lock + volatile value, careful double-check     |
| Definite assignment (12)                          | Branched assignment of final variable                  |

These bugs come from `final` not doing what the developer assumed. The compiler catches some; the others (concurrency, deep immutability) require design discipline.
