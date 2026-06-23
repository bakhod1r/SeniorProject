# Refactoring Toward Creational Patterns — Find the Bug

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

Each snippet contains a *creation* bug or a mis-applied creational refactoring — a factory that still leaks concretions, a Builder that yields invalid objects, a thread-unsafe Singleton, a broken clone. Diagnose it, then fix it. Read the code before expanding the answer.

---

## Bug 1 — The factory that still leaks concretions

```java
public final class ParserFactory {
    public CsvParser create(String type) {          // <-- return type
        if (type.equals("csv"))  return new CsvParser();
        if (type.equals("json")) return new JsonParser();   // won't even compile? or worse
        throw new IllegalArgumentException(type);
    }
}
```

<details><summary>Diagnosis & fix</summary>

The factory's whole purpose — decoupling clients from concrete classes — is defeated because it **returns the concrete type `CsvParser`**, not the `Parser` interface. (As written it won't compile for the JSON branch unless `JsonParser extends CsvParser`, which is its own design crime.) Clients that hold a `CsvParser` are still coupled to a concretion and can't be handed a `JsonParser`.

Fix: return the **abstraction**.

```java
public final class ParserFactory {
    public Parser create(String type) {
        return switch (type) {
            case "csv"  -> new CsvParser();
            case "json" -> new JsonParser();
            default -> throw new IllegalArgumentException(type);
        };
    }
}
```
A factory must return the interface, or it isn't encapsulating anything.
</details>

---

## Bug 2 — The Builder that allows invalid partial objects

```java
public class Subscription {
    private String planId; private LocalDate start; private LocalDate end;

    public static class Builder {
        private final Subscription s = new Subscription();
        public Builder plan(String id) { s.planId = id; return this; }
        public Builder start(LocalDate d) { s.start = d; return this; }
        public Builder end(LocalDate d) { s.end = d; return this; }
        public Subscription build() { return s; }     // <-- no validation
    }
}
Subscription sub = new Subscription.Builder().start(today).build(); // planId null, end < start possible
```

<details><summary>Diagnosis & fix</summary>

Two bugs. (1) `build()` does **no validation**, so it happily returns an object with a null `planId` and an `end` before `start` — the very "invalid partial object" a Builder is supposed to prevent. (2) The Builder mutates a **shared, live `Subscription` instance**; if a caller keeps the Builder and calls `build()` twice, both results alias the *same* object, and later setter calls mutate already-"built" instances.

Fix: hold raw fields in the Builder, validate in `build()`, construct a fresh immutable target via a private constructor.

```java
public class Subscription {
    private final String planId; private final LocalDate start, end;
    private Subscription(Builder b){ planId=b.planId; start=b.start; end=b.end; }
    public static class Builder {
        private String planId; private LocalDate start, end;
        public Builder plan(String id){ planId=id; return this; }
        public Builder start(LocalDate d){ start=d; return this; }
        public Builder end(LocalDate d){ end=d; return this; }
        public Subscription build() {
            if (planId == null) throw new IllegalStateException("planId required");
            if (start == null)  throw new IllegalStateException("start required");
            if (end != null && end.isBefore(start)) throw new IllegalStateException("end < start");
            return new Subscription(this);     // fresh, validated, immutable
        }
    }
}
```
</details>

---

## Bug 3 — The thread-unsafe Singleton (and reordering hazard)

```java
public class Cache {
    private static Cache instance;          // not volatile
    private final Map<String,Object> map = new HashMap<>();   // not thread-safe either
    private Cache() {}
    public static Cache getInstance() {
        if (instance == null) {
            instance = new Cache();         // race: two threads can both create
        }
        return instance;
    }
}
```

<details><summary>Diagnosis & fix</summary>

Three defects. (1) **Race on lazy init** — two threads can both see `instance == null` and create two `Cache` objects, violating the singleton invariant and losing writes. (2) Even with double-checked locking, a non-`volatile` field permits a thread to observe a **partially constructed** object due to reordering. (3) The internal `HashMap` is **not thread-safe**, so concurrent `get/put` corrupt it regardless of how the instance is created.

Best fix — **initialization-on-demand holder** (lazy, lock-free, correct), plus a concurrent map:

```java
public class Cache {
    private final Map<String,Object> map = new ConcurrentHashMap<>();
    private Cache() {}
    private static class Holder { static final Cache INSTANCE = new Cache(); }
    public static Cache getInstance() { return Holder.INSTANCE; }
}
```
The deeper fix: a mutable global cache is a [hidden dependency](./professional.md). Prefer **Inline Singleton** — inject a single `Cache` from the composition root so tests get a fresh instance.
</details>

---

## Bug 4 — The broken clone (shallow copy aliasing)

```java
class Order implements Cloneable {
    List<LineItem> items = new ArrayList<>();
    @Override public Order clone() {
        try { return (Order) super.clone(); }   // shallow: copies the LIST REFERENCE
        catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
Order a = new Order(); a.items.add(new LineItem("x"));
Order b = a.clone();
b.items.add(new LineItem("y"));   // also mutates a.items — aliased!
```

<details><summary>Diagnosis & fix</summary>

`Object.clone()` does a **shallow copy**: `b.items` and `a.items` point to the *same* `ArrayList`. Adding to one mutates both — the variants aren't isolated, which destroys the whole point of Prototype. Plus `Cloneable` is a broken contract (no `clone` on the interface; bypasses constructors; *Effective Java* Item 13).

Fix: prefer a **copy constructor** that deep-copies mutable state.

```java
final class Order {
    private final List<LineItem> items;
    Order() { this.items = new ArrayList<>(); }
    Order(Order other) { this.items = new ArrayList<>(other.items); }  // deep copy of the list
    Order copy() { return new Order(this); }
}
```
(If `LineItem` itself is mutable and you mutate copies independently, deep-copy each element too.)
</details>

---

## Bug 5 — Factory Method overriding a non-overridable creation point

```java
class ReportBuilder {
    private final Formatter formatter = createFormatter();   // <-- called in field init / ctor
    protected Formatter createFormatter() { return new PlainFormatter(); }
}
class HtmlReportBuilder extends ReportBuilder {
    private final String css = "body{}";
    @Override protected Formatter createFormatter() { return new HtmlFormatter(css); }  // css is null!
}
```

<details><summary>Diagnosis & fix</summary>

A classic **calling an overridable method during construction** bug. The superclass field initializer (which runs as part of the superclass constructor, *before* the subclass's fields are initialized) calls the overridden `createFormatter()`. At that moment `HtmlReportBuilder.css` is still `null` — its initializer hasn't run yet — so `HtmlFormatter` is built with a null CSS. Factory Method hooks must not be invoked from a constructor.

Fix: make creation lazy (first use) or use an explicit `init()` after construction, so the subclass is fully built before the hook fires.

```java
class ReportBuilder {
    private Formatter formatter;            // not initialized in ctor
    protected Formatter createFormatter() { return new PlainFormatter(); }
    Formatter formatter() {                 // lazy: subclass fully constructed by now
        if (formatter == null) formatter = createFormatter();
        return formatter;
    }
}
```
Rule: never call an overridable method from a constructor or field initializer.
</details>

---

## Bug 6 — The "factory" that's really a service locator

```java
class OrderService {
    void place(Order o) {
        Inventory inv = AppContainer.get(Inventory.class);    // <-- pulls from global container
        Payments  pay = AppContainer.get(Payments.class);
        inv.reserve(o); pay.charge(o);
    }
}
```

<details><summary>Diagnosis & fix</summary>

This isn't a factory improving testability — it's the **service locator anti-pattern**. `OrderService`'s real dependencies (`Inventory`, `Payments`) are **hidden** inside the method body; the constructor signature lies about what the class needs. Tests must configure a global `AppContainer`, and parallel tests collide on it. It re-creates every problem Inline Singleton removes.

Fix: **constructor injection** — make the dependencies explicit and substitutable.

```java
class OrderService {
    private final Inventory inv; private final Payments pay;
    OrderService(Inventory inv, Payments pay) { this.inv = inv; this.pay = pay; }
    void place(Order o) { inv.reserve(o); pay.charge(o); }
}
```
The container should *inject* dependencies at the composition root, never be reached into from inside a class.
</details>

---

## Bug 7 — Static factory caching mutable objects

```java
public final class Color {
    private static final Map<String,Color> CACHE = new HashMap<>();
    private int[] rgb;
    private Color(int[] rgb) { this.rgb = rgb; }
    public static Color of(String name) {
        return CACHE.computeIfAbsent(name, n -> new Color(lookup(n)));  // shared, mutable
    }
    public void tint(int delta) { for (int i=0;i<rgb.length;i++) rgb[i]+=delta; }  // mutates shared!
}
Color red = Color.of("red");
red.tint(10);                  // mutates the cached "red" for EVERYONE
Color red2 = Color.of("red");  // same instance, already tinted
```

<details><summary>Diagnosis & fix</summary>

A static factory that **caches instances** (a fine instance-control technique) but caches a **mutable** object. Because `Color.of("red")` returns a shared cached instance, any caller's `tint()` mutates the singleton-per-name `Color` for *every* other caller — spooky action at a distance. Caching is only safe for **immutable** values.

Fix: make `Color` immutable; mutation returns a *new* instance.

```java
public final class Color {
    private static final Map<String,Color> CACHE = new ConcurrentHashMap<>();
    private final int[] rgb;
    private Color(int[] rgb) { this.rgb = rgb.clone(); }
    public static Color of(String name) { return CACHE.computeIfAbsent(name, n -> new Color(lookup(n))); }
    public Color tint(int delta) {            // returns a new Color; cache stays pristine
        int[] copy = rgb.clone();
        for (int i=0;i<copy.length;i++) copy[i]+=delta;
        return new Color(copy);
    }
}
```
Instance-controlling factories (`Integer.valueOf`, enum singletons) work *because* the cached objects are immutable.
</details>

---

## Next

- [optimize.md](./optimize.md) — spot creation smells and propose refactorings.
- [tasks.md](./tasks.md) — guided refactoring exercises.
- Theory: [junior.md](./junior.md) · [middle.md](./middle.md) · [senior.md](./senior.md) · [professional.md](./professional.md)
