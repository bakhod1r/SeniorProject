# Encapsulation — Find the Bug

Twelve buggy snippets. Each compiles. Each leaks state, breaks invariants, or violates encapsulation.

---

## Bug 1 — Public mutable field

```java
public class Config {
    public Map<String, String> settings = new HashMap<>();
}
```

**Why?** Any code can `config.settings = null` or `config.settings.clear()`. No validation, no thread safety, no future flexibility.

**Fix:** private field, controlled accessors.
```java
public class Config {
    private final Map<String, String> settings = new ConcurrentHashMap<>();
    public String get(String k) { return settings.get(k); }
    public void put(String k, String v) { settings.put(k, v); }
}
```

---

## Bug 2 — Returning internal mutable list

```java
public class Cart {
    private final List<Item> items = new ArrayList<>();
    public List<Item> items() { return items; }
}
```

**Why?** Caller can `cart.items().clear()`, mutating internal state.

**Fix:** return immutable view or copy:
```java
public List<Item> items() { return List.copyOf(items); }
// or
public List<Item> items() { return Collections.unmodifiableList(items); }
```

---

## Bug 3 — Storing mutable input by reference

```java
public class Order {
    private final List<Item> items;
    public Order(List<Item> items) {
        this.items = items;
    }
}

List<Item> caller = new ArrayList<>(Arrays.asList(item1, item2));
Order o = new Order(caller);
caller.add(item3);   // also affects Order's items!
```

**Why?** The constructor stored the *reference* to the caller's list. Mutations to caller's list affect Order.

**Fix:** copy in the constructor:
```java
public Order(List<Item> items) { this.items = List.copyOf(items); }
```

---

## Bug 4 — Setter without validation

```java
public class Person {
    private int age;
    public void setAge(int age) { this.age = age; }
}

person.setAge(-100);   // breaks invariant
```

**Why?** Setter accepts any int, including negatives. The class can't claim to maintain "age >= 0."

**Fix:** validate, or remove the setter entirely:
```java
public void setAge(int age) {
    if (age < 0) throw new IllegalArgumentException();
    this.age = age;
}
```

Better: make `Person` immutable with a record.

---

## Bug 5 — Leaking `this` from constructor

```java
public class TimeProbe {
    public TimeProbe(Scheduler s) {
        s.scheduleAt(this, () -> tick());   // 'this' escapes
        this.lastTick = Instant.now();
    }
    private Instant lastTick;
    private void tick() { /* uses lastTick */ }
}
```

**Why?** Scheduler may invoke `tick()` from another thread before `lastTick` is initialized. NPE possible.

**Fix:** static factory that schedules after construction:
```java
public static TimeProbe register(Scheduler s) {
    var p = new TimeProbe();
    s.scheduleAt(p, p::tick);
    return p;
}
```

---

## Bug 6 — Date as a mutable type

```java
public class Period {
    private final Date start;
    public Period(Date start) { this.start = start; }
    public Date start() { return start; }
}

Period p = new Period(new Date(0));
p.start().setTime(System.currentTimeMillis());   // !! mutates internal state
```

**Why?** `java.util.Date` is mutable. Returning the internal `Date` lets callers mutate it.

**Fix:** use immutable `Instant` / `LocalDate` / `LocalDateTime` from `java.time`. If stuck with `Date`, defensively copy:
```java
public Date start() { return new Date(start.getTime()); }
```

---

## Bug 7 — Inner class pinning outer

```java
public class Outer {
    private final byte[] payload = new byte[10_000_000];
    public Iterator<Integer> ids() {
        return new Iterator<>() { /* implicit reference to Outer.this */
            int i = 0;
            public boolean hasNext() { return i < 100; }
            public Integer next() { return i++; }
        };
    }
}
```

**Why?** Anonymous inner class holds an implicit `Outer.this` reference. Iterator pins the entire 10 MB payload alive.

**Fix:** use a static nested class:
```java
private static class IdIterator implements Iterator<Integer> {
    int i = 0;
    public boolean hasNext() { return i < 100; }
    public Integer next() { return i++; }
}
public Iterator<Integer> ids() { return new IdIterator(); }
```

---

## Bug 8 — Encapsulation broken via subclass

```java
public class Base {
    protected int counter;
}
public class Sub extends Base {
    public void reset() { counter = 0; }   // bypasses Base's contract
}
```

**Why?** `Base.counter` is `protected`, so any subclass can mutate it directly, possibly violating Base's invariants.

**Fix:** make `counter` private and provide protected accessors that enforce invariants:
```java
public class Base {
    private int counter;
    protected void incrementCounter() { counter++; }
    protected int counter() { return counter; }
}
```

Or make the class `final` if subclasses aren't supposed to extend.

---

## Bug 9 — Reflection-aware private

```java
public class Secret {
    private String password = "abc123";
}

Field f = Secret.class.getDeclaredField("password");
f.setAccessible(true);
f.set(secret, "intruder");
```

**Why?** Reflection bypasses `private`. Without JPMS or security manager, anyone can read/write.

**Fix:** for sensitive data, don't store in plaintext. Encrypt at rest. Use JPMS (`opens` only to specific modules). Or use security manager (deprecated; consider alternatives).

---

## Bug 10 — Mutable collection passed to record

```java
public record Tags(List<String> values) { }
List<String> mut = new ArrayList<>();
Tags t = new Tags(mut);
mut.add("X");   // also affects t.values()
```

**Why?** Records hold the reference to the passed list. Mutation through the original list is visible.

**Fix:** compact constructor copies:
```java
public record Tags(List<String> values) {
    public Tags {
        values = List.copyOf(values);
    }
}
```

---

## Bug 11 — Static field as global state

```java
public class Inventory {
    public static final List<Item> ITEMS = new ArrayList<>();
}
```

**Why?** Public mutable static collection. Anyone can add/remove. No validation. Not thread-safe.

**Fix:** make private, expose controlled methods:
```java
public class Inventory {
    private static final List<Item> ITEMS = Collections.synchronizedList(new ArrayList<>());
    public static synchronized void add(Item i) { ITEMS.add(i); }
    public static List<Item> all() { return List.copyOf(ITEMS); }
}
```

---

## Bug 12 — `clone()` shallow copy

```java
public class Polygon implements Cloneable {
    private List<Point> points = new ArrayList<>();
    @Override public Polygon clone() {
        try { return (Polygon) super.clone(); } catch (CloneNotSupportedException e) { throw new AssertionError(); }
    }
}

Polygon p1 = new Polygon();
p1.points.add(new Point(0, 0));
Polygon p2 = p1.clone();
p2.points.add(new Point(1, 1));
System.out.println(p1.points.size());   // 2 — shared!
```

**Why?** `super.clone()` is a shallow copy. Both polygons reference the same `points` list.

**Fix:** use a copy constructor or factory; deep-copy the list:
```java
public Polygon(Polygon other) {
    this.points = new ArrayList<>(other.points);
}
```

Better yet: avoid `Cloneable` entirely.

---

## Pattern recap

| Bug | Family                              | Cure                                |
|-----|-------------------------------------|-------------------------------------|
| 1   | Public mutable field                 | Private + accessor                  |
| 2   | Returning internal collection        | `List.copyOf` / unmodifiable       |
| 3   | Storing input reference              | Defensive copy in ctor              |
| 4   | Setter without validation            | Validate or remove                  |
| 5   | Leaking `this`                       | Static factory                      |
| 6   | Returning mutable Date               | Use `java.time` or copy             |
| 7   | Anonymous class pins outer            | Static nested class                 |
| 8   | `protected` field                    | Private + protected accessor        |
| 9   | Reflection bypassing private         | JPMS, encryption, security boundary |
| 10  | Record component is mutable          | Compact ctor: copy                  |
| 11  | Static mutable collection            | Private + sync + immutable view     |
| 12  | Shallow clone                        | Copy ctor / factory                 |

---

**Memorize the shapes**: most encapsulation bugs are about exposed mutable state. The cure is almost always: private + immutable + controlled access. Modern Java (records, sealed types, modules) makes this easier. Use them.
