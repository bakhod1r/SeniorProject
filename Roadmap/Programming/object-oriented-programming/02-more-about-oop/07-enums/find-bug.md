# Enums — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of an enum misuse.

---

## Bug 1 — Storing ordinal in DB

```java
public class UserPreferences {
    public enum Theme { LIGHT, DARK, SYSTEM }

    public void save(Theme t) {
        db.execute("UPDATE prefs SET theme = ?", t.ordinal());
    }
}
```

**Why?** If the dev later adds `HIGH_CONTRAST` between LIGHT and DARK (or reorders), all stored ordinals shift, breaking historical data.

**Fix:** store `name()`:
```java
db.execute("UPDATE prefs SET theme = ?", t.name());
```

---

## Bug 2 — Public constructor attempt

```java
public enum Currency {
    USD, EUR;
    public Currency() { ... }   // ERROR
}
```

**Why?** Enum constructors can't be public. Default access is allowed (treated as private).

**Fix:** remove `public`, or make it `Currency()` with no modifier.

---

## Bug 3 — Heavy work in constructor

```java
public enum Service {
    INSTANCE;
    private final Connection conn = openConnection();
    private Connection openConnection() {
        return DriverManager.getConnection("jdbc:...");   // expensive, may fail
    }
}
```

**Why?** Constructor runs at class init. Failure throws `ExceptionInInitializerError` and the enum class becomes unusable.

**Fix:** lazy initialization:
```java
public enum Service {
    INSTANCE;
    private volatile Connection conn;
    public Connection conn() {
        if (conn == null) synchronized (this) { if (conn == null) conn = openConnection(); }
        return conn;
    }
}
```

---

## Bug 4 — Enum in switch with default that swallows new constants

```java
enum Day { MON, TUE, WED, THU, FRI, SAT, SUN }

String type(Day d) {
    return switch (d) {
        case MON, TUE, WED, THU, FRI -> "weekday";
        case SAT, SUN -> "weekend";
        default -> "unknown";   // hides any future addition
    };
}
```

**Why?** If a `Day.HOLIDAY` is added later, this method returns "unknown" silently.

**Fix:** remove `default`. Compiler will force update on every switch when enum changes.

---

## Bug 5 — Mutable per-constant state

```java
public enum Counter {
    INSTANCE;
    private int count;
    public void inc() { count++; }
    public int count() { return count; }
}
```

**Why?** `count` is shared mutable state across all callers. Without synchronization, races occur.

**Fix:** use `AtomicInteger`:
```java
private final AtomicInteger count = new AtomicInteger();
public void inc() { count.incrementAndGet(); }
public int count() { return count.get(); }
```

---

## Bug 6 — Missing case in pattern matching switch

```java
sealed interface Result permits Success, Failure { }
// later, someone adds Pending

switch (result) {
    case Success s -> ...;
    case Failure f -> ...;
}    // ERROR after Pending added — compiler points to this switch
```

**Why?** Adding a new permitted variant breaks every switch over the sealed type.

**Fix:** add the new case (or use enum's pattern matching exhaustiveness as a feature, not a bug — this is the compiler helping you).

---

## Bug 7 — Comparing enum with `equals`

```java
if (direction.equals(Direction.NORTH)) { ... }
```

**Why?** Works but `==` is preferred — handles null safely (`null == Direction.NORTH` is false; `null.equals(...)` is NPE).

**Fix:**
```java
if (direction == Direction.NORTH) { ... }
```

---

## Bug 8 — Reflection to create enum instance

```java
Constructor<MyEnum> c = MyEnum.class.getDeclaredConstructor(...);
c.setAccessible(true);
MyEnum bogus = c.newInstance(...);   // throws IllegalArgumentException
```

**Why?** The JVM forbids reflective enum instantiation to preserve the singleton property. (And rightly so.)

**Fix:** don't try. Use `Enum.valueOf` to get existing constants.

---

## Bug 9 — Enum constants in unstable order for serialization

```java
public enum Status { ACTIVE, INACTIVE, PENDING }
```

If a JSON serializer uses ordinals (rare, but possible with custom config), reordering breaks consumers.

**Fix:** ensure all serializers use `name()`:
```java
@JsonProperty("ACTIVE")    // explicit if needed
ACTIVE,
```

---

## Bug 10 — EnumSet with mixed types

```java
EnumSet<Day> days = EnumSet.of(Day.MON, Day.TUE);
days.add((Day) (Object) Direction.NORTH);   // ClassCastException at insertion (or earlier)
```

**Why?** EnumSet enforces type homogeneity. Mixing types causes runtime failure.

**Fix:** don't mix. EnumSet is parametric — let the type system catch this.

---

## Bug 11 — `valueOf` without exception handling

```java
public Theme parseTheme(String s) {
    return Theme.valueOf(s);   // throws IllegalArgumentException for unknown
}
```

**Why?** Caller may not know what `s` is. Unhandled exception.

**Fix:** wrap with safe lookup:
```java
public Optional<Theme> parseTheme(String s) {
    try { return Optional.of(Theme.valueOf(s)); }
    catch (IllegalArgumentException e) { return Optional.empty(); }
}
```

---

## Bug 12 — Enum with one constant used as singleton without thread safety

```java
public enum Cache {
    INSTANCE;
    private final Map<String, Object> data = new HashMap<>();   // !! not thread-safe
    public Object get(String k) { return data.get(k); }
    public void put(String k, Object v) { data.put(k, v); }
}
```

**Why?** Multiple threads can corrupt `HashMap`.

**Fix:** use a thread-safe map:
```java
private final Map<String, Object> data = new ConcurrentHashMap<>();
```

The enum guarantees instance singleton, but doesn't help with internal state thread safety.

---

## Pattern recap

| Bug | Family                        | Cure                                   |
|-----|-------------------------------|----------------------------------------|
| 1   | `ordinal()` in storage         | Use `name()`                           |
| 2   | Public constructor             | Remove `public`                        |
| 3   | Heavy work in ctor             | Lazy init                              |
| 4   | `default` in exhaustive switch | Remove default                         |
| 5   | Mutable shared state           | Atomic types                           |
| 6   | Missed case after expansion    | Add case (compiler tells you where)    |
| 7   | `equals` over `==`             | Use `==`                               |
| 8   | Reflection to instantiate      | Forbidden; use valueOf                 |
| 9   | Ordinal-based serialization    | Name-based                             |
| 10  | Mixed types in EnumSet         | Type system enforces                   |
| 11  | Unhandled `valueOf` exception  | Optional wrapper                       |
| 12  | Non-thread-safe state in singleton | ConcurrentHashMap                  |

---

**Memorize the shapes**: most enum bugs are about (a) ordinal misuse, (b) exhaustiveness defeated by `default`, (c) heavy work in constructors, or (d) misunderstanding singleton ≠ thread-safe state. The rules are simple; respect them.
