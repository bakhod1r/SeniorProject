# Attributes and Methods — Find the Bug

> 12 buggy snippets, each a real production-grade trap around fields and methods. For each one: read carefully, identify *why* it bites, *when* it bites (always vs. only sometimes), and the fix.

---

## Bug 1 — Static field for shared state

```java
public class UserSession {
    public static User currentUser;     // shared by everyone

    public void login(User u)   { currentUser = u; }
    public void logout()        { currentUser = null; }
    public User who()           { return currentUser; }
}
```

Two HTTP requests come in concurrently. Each thread calls `login` with a different `User`. Then both call `who()`.

**Bug.** `currentUser` is `static` — there is exactly one across the entire JVM. Threads overwrite each other's "session." `who()` returns whoever logged in last, regardless of which thread is asking.

**Fix.** Either pass `User` explicitly through the call stack, or use `ThreadLocal<User>` for per-thread "current user" semantics, or store sessions keyed by request ID.

**Lesson.** `static` mutable state is global state. Thread safety is a question of *who can see this field at the same time*, and `static` answers "everyone."

---

## Bug 2 — Forgotten `static` keyword

```java
public class Config {
    public final String dbUrl = "jdbc:postgresql://...";
    public final int    poolSize = 10;
}

new Config().dbUrl;          // works
Config.dbUrl;                // ❌ compile error
```

**Bug.** The author meant constants but wrote instance fields. Each `new Config()` allocates a copy. Static analysis tools flag, but in practice this slips through code review.

**Fix.**

```java
public final class Config {
    public static final String DB_URL    = "jdbc:postgresql://...";
    public static final int    POOL_SIZE = 10;

    private Config() {}   // prevent instantiation
}
```

**Lesson.** Constants are `static final`. Instance constants on a class with no instance state is a smell — you've reinvented globals in object form.

---

## Bug 3 — Static initializer order

```java
public class Constants {
    public static final int MAX     = MIN + 100;
    public static final int MIN     = 50;
}

System.out.println(Constants.MAX);   // ???
```

**Bug.** Static initializers run in source order. When `MAX` is being assigned, `MIN` still holds its default of `0`. So `MAX = 100`, not `150`.

**Fix.** Reorder declarations or use an explicit initializer block that establishes them together. With `final` primitive constants whose initializers are *constant expressions*, you can also rely on inlining at compile time — but a forward reference to a `final static` from another `final static` initializer doesn't qualify.

**Lesson.** Static initialization is sequential. When dependencies between statics exist, declare them top-down or use explicit initialization order.

---

## Bug 4 — `final` field reassigned via reflection

```java
public final class Constants {
    public static final int MAGIC = 42;
}

Field f = Constants.class.getDeclaredField("MAGIC");
f.setAccessible(true);
f.setInt(null, 999);                  // bypasses `final`
System.out.println(Constants.MAGIC);  // could be 42, could be 999
```

**Bug.** Reflection can reassign a `static final` field, but the JIT may have inlined the original value into call sites. Reads through inlined call sites still see `42`; reads through fresh code see `999`. The result is non-deterministic.

**Fix.** Don't do this. Reflection-mutating `final` is undefined behavior in modern Java (and explicitly disallowed for record components, hidden classes, etc.). Frameworks that legitimately need to change a constant should use `VarHandle` and a non-final field.

**Lesson.** `final` is a contract the JIT relies on. Breaking it via reflection breaks the JIT's assumptions. Java 17+ flags such operations as warnings; future versions will reject them.

---

## Bug 5 — Returning a mutable internal collection

```java
public class Roster {
    private final List<String> names = new ArrayList<>();

    public List<String> names() { return names; }
}

Roster r = new Roster();
r.names().add("Alice");          // bypasses any future validation
r.names().clear();                // wipes the roster
```

**Bug.** Callers can mutate the internal list freely. Any invariant the class might enforce (uniqueness, ordering, size limit) can be violated.

**Fix.**

```java
public List<String> names() { return List.copyOf(names); }
// or
public List<String> names() { return Collections.unmodifiableList(names); }
```

`List.copyOf` returns a new list (a true defensive copy). `unmodifiableList` returns a *view* over the live list — callers can't mutate via the view, but if the underlying list mutates, the view reflects it.

**Lesson.** "Private field" + "live getter" = effectively public. Defend the boundary.

---

## Bug 6 — Setter that takes the same reference

```java
public class Inventory {
    private List<Item> items;

    public void setItems(List<Item> items) { this.items = items; }
}

List<Item> external = new ArrayList<>();
inventory.setItems(external);
external.clear();                         // also clears inventory.items
```

**Bug.** The setter stores the caller's list directly. The caller still holds the reference and can mutate after handing it over. The setter does not own the data; it merely shares it.

**Fix.**

```java
public void setItems(List<Item> items) { this.items = List.copyOf(items); }
```

**Lesson.** Defense on the way *in* is just as important as on the way *out*. Same rule for arrays and pre-`java.time` types like `Date`.

---

## Bug 7 — Overload resolution surprise

```java
public class Repo {
    public void delete(Object obj)  { /* deletes by reference */ }
    public void delete(Long id)     { /* deletes by id */ }
}

Long id = 42L;
repo.delete(id);                          // calls delete(Long)
repo.delete(null);                         // ???
```

**Bug.** `repo.delete(null)` is ambiguous. Both overloads accept `null`. The compiler picks the *most specific* — `Long` is a subtype of `Object`, so `delete(Long)` wins. But the author of `null` likely didn't know that, and a refactoring that adds a third overload (`delete(String)`) suddenly makes the call ambiguous and fails to compile.

**Fix.** Don't overload on supertypes that include `null`. Rename one of them: `deleteById(Long)`, `delete(Entity)`. Or, since `null` is rarely meaningful for delete, document that `null` is rejected and add `Objects.requireNonNull` at the top.

**Lesson.** Overload resolution at the most-specific level is a maintenance hazard. Renaming is almost always cleaner.

---

## Bug 8 — Boolean parameter that flips meaning

```java
public class Renderer {
    public void render(Document doc, boolean compress) {
        if (compress) writeGzip(doc);
        else          writePlain(doc);
    }
}

renderer.render(doc, true);   // wait — does true mean compressed or not compressed?
renderer.render(doc, false);  // I have no idea without reading the implementation
```

**Bug.** A boolean parameter at the call site is *opaque*. The reader has to look up which way the bool means what. Worse — when the requirements change ("now we have three modes: gzip, brotli, plain") the boolean balloons into more booleans or, worse, gets reinterpreted.

**Fix.** Replace with an enum:

```java
public enum CompressionMode { NONE, GZIP, BROTLI }
public void render(Document doc, CompressionMode mode) { ... }
```

Or split into two methods:

```java
public void render(Document doc)             { ... }
public void renderCompressed(Document doc)   { ... }
```

**Lesson.** Boolean parameters are a code smell when they change behavior modes. They lose all meaning at the call site. Use enums or method splits.

---

## Bug 9 — Method that should be `final` isn't

```java
public class CacheBase {
    protected Map<String, Object> cache = new HashMap<>();
    public void put(String k, Object v) {
        if (k == null) throw new IllegalArgumentException();
        cache.put(k, v);
    }
}

public class LoggingCache extends CacheBase {
    @Override
    public void put(String k, Object v) {
        log("putting " + k);
        cache.put(k, v);                   // skips the null check!
    }
}
```

**Bug.** The subclass's override drops the null-check. Now `loggingCache.put(null, "x")` silently puts `null -> "x"` and breaks the contract.

**Fix.** Either mark `put` `final` so it can't be overridden, or use the template method pattern:

```java
public final void put(String k, Object v) {
    if (k == null) throw new IllegalArgumentException();
    putInternal(k, v);
}
protected void putInternal(String k, Object v) { cache.put(k, v); }
```

Subclasses override `putInternal` and never see uninvalidated input.

**Lesson.** Validation in a non-`final` method is a suggestion to subclasses, not an enforcement. Use `final` or extract a sealed entry point.

---

## Bug 10 — Caller sees stale field

```java
public class Switch {
    private boolean on = false;
    public void turnOn()      { on = true; }
    public boolean isOn()     { return on; }
}

// Thread A
sw.turnOn();
// Thread B
while (!sw.isOn()) { /* spin */ }      // may never see `true`
```

**Bug.** Without synchronization, the JMM makes no guarantee that thread B will ever see the write made by thread A. The compiler may hoist the read; the CPU may cache the value; the spin loop may run forever.

**Fix.**

```java
private volatile boolean on = false;     // simplest
```

Or use `synchronized` accessors, or `AtomicBoolean`.

**Lesson.** "It seems to work" with cross-thread sharing is the most dangerous result. Without `volatile`/`synchronized`/`Atomic*`/`final`, you're betting on JIT and CPU behavior holding through every refactor.

---

## Bug 11 — Method calling itself unintentionally

```java
public class Collection {
    private List<String> items = new ArrayList<>();
    public void add(String item) {
        if (item == null) return;
        add(item);                         // ??? — typo for items.add
    }
}
```

**Bug.** Stack overflow. The author meant `items.add(item)` (delegating to the list field) but wrote `add(item)` (recursive call into themselves).

**Fix.**

```java
public void add(String item) {
    if (item == null) return;
    items.add(item);
}
```

**Lesson.** Naming a wrapper method exactly the same as the wrapped method tempts this typo. Tools (linters, unit tests) catch it; humans don't always.

---

## Bug 12 — Method that mutates parameters

```java
public BigDecimal sumWithDiscount(List<BigDecimal> prices, BigDecimal discount) {
    for (int i = 0; i < prices.size(); i++) {
        prices.set(i, prices.get(i).multiply(discount));   // mutates caller's list!
    }
    BigDecimal total = BigDecimal.ZERO;
    for (BigDecimal p : prices) total = total.add(p);
    return total;
}
```

The caller does:

```java
List<BigDecimal> prices = ...;
BigDecimal totalA = sumWithDiscount(prices, new BigDecimal("0.9"));
BigDecimal totalB = sumWithDiscount(prices, new BigDecimal("0.9"));   // applied twice now
```

**Bug.** The method mutates the caller's list. The second call applies the discount to already-discounted values. Double discount.

**Fix.** Don't mutate parameters:

```java
public BigDecimal sumWithDiscount(List<BigDecimal> prices, BigDecimal discount) {
    BigDecimal total = BigDecimal.ZERO;
    for (BigDecimal p : prices) total = total.add(p.multiply(discount));
    return total;
}
```

**Lesson.** Methods that *look* pure but mutate parameters are landmines. As a rule, **don't mutate parameters** unless the method's name explicitly signals it (`fillArray`, `loadInto`).

---

## Pattern summary

| Bug type                                        | Watch for                                            |
|-------------------------------------------------|------------------------------------------------------|
| Static / shared state (1, 2)                    | `static` + mutability                                |
| Initialization order (3, 4)                     | Forward reference between statics; reflective writes |
| Defensive-copy gaps (5, 6)                      | Direct reference handed in or out                    |
| Overload / parameter design (7, 8, 9, 11, 12)   | Booleans, ambiguous nulls, recursive typos, mutating params |
| Concurrency visibility (10)                     | Cross-thread sharing without `volatile`/`Atomic*`    |

These are the most common attribute/method mistakes in real Java codebases. Static analysis (Error Prone, SpotBugs, PMD, IntelliJ inspections) catches most of them — but only if you wire them up. For the rest, code review and tests are the safety net.
