# Record — Optimization

Twelve before/after exercises focused on record performance and idiomatic use.

---

## Optimization 1 — Replace POJO with record

**Before:**
```java
public class User {
    private final String name;
    private final int age;
    public User(String name, int age) { this.name = name; this.age = age; }
    public String getName() { return name; }
    public int getAge() { return age; }
    @Override public boolean equals(Object o) { /* 8 lines */ }
    @Override public int hashCode() { return Objects.hash(name, age); }
    @Override public String toString() { return "User(" + name + "," + age + ")"; }
}
```

**After:**
```java
public record User(String name, int age) { }
```

**Why:** less code, JIT-friendly, immutable, automatic equals/hashCode/toString.

---

## Optimization 2 — Defensive copy via `List.copyOf`

**Before:**
```java
public record Tags(List<String> values) {
    public Tags { values = Collections.unmodifiableList(new ArrayList<>(values)); }
}
```

**After:**
```java
public record Tags(List<String> values) {
    public Tags { values = List.copyOf(values); }
}
```

**Why:** `List.copyOf` returns the input directly if already immutable; otherwise creates one immutable copy. Skips wrapper layers.

---

## Optimization 3 — Records over Map<String, Object>

**Before:**
```java
Map<String, Object> user = Map.of("name", "Alice", "age", 30);
String name = (String) user.get("name");
```

Type-unsafe, hash lookup overhead.

**After:**
```java
record User(String name, int age) { }
User user = new User("Alice", 30);
String name = user.name();
```

Type-safe, direct field access, JIT-friendly.

---

## Optimization 4 — Records as map keys

**Before:**
```java
String key = userId + ":" + sessionId;
map.put(key, value);
```

String concatenation each call; key allocation.

**After:**
```java
record CacheKey(long userId, String sessionId) { }
map.put(new CacheKey(userId, sessionId), value);
```

Slightly more allocations but better hashCode distribution and type safety.

---

## Optimization 5 — Pattern matching over instanceof + cast

**Before:**
```java
if (obj instanceof User) {
    User u = (User) obj;
    System.out.println(u.name());
}
```

**After:**
```java
if (obj instanceof User u) {
    System.out.println(u.name());
}
```

Or with deconstruction:

```java
if (obj instanceof User(String name, int age)) {
    System.out.println(name);
}
```

Same JIT performance, much cleaner code.

---

## Optimization 6 — Sealed records over visitor

**Before (visitor pattern):**
```java
interface Shape {
    <R> R accept(ShapeVisitor<R> v);
}
interface ShapeVisitor<R> {
    R circle(Circle);
    R square(Square);
}
```

**After (sealed + records):**
```java
sealed interface Shape permits Circle, Square { }
record Circle(double r) implements Shape { }
record Square(double s) implements Shape { }

double area(Shape s) {
    return switch (s) {
        case Circle(double r) -> Math.PI * r * r;
        case Square(double side) -> side * side;
    };
}
```

Less boilerplate, type-safe, exhaustive.

---

## Optimization 7 — Record + escape analysis

```java
public double distance(double x1, double y1, double x2, double y2) {
    Point a = new Point(x1, y1);
    Point b = new Point(x2, y2);
    return Math.hypot(a.x() - b.x(), a.y() - b.y());
}
```

If `a` and `b` don't escape, C2 scalarizes — no allocation. Verify with `-XX:+PrintEliminateAllocations`.

---

## Optimization 8 — Avoid record allocation for transient values

**Before:**
```java
List<Pair<String, Integer>> pairs = stream.map(s -> new Pair<>(s, s.length())).toList();
```

If you only need `s.length()` and don't keep the pair, you don't need a record:

**After:**
```java
List<Integer> lengths = stream.map(String::length).toList();
```

But for cases where the structure matters (returning multiple values from a method, etc.), records are still cheap.

---

## Optimization 9 — Avoid premature `with` chains

**Before:**
```java
User u = original;
u = u.withName("Alice").withAge(30).withEmail("a@b.com");
```

Allocates 3 intermediate records.

**After (when many fields change at once):**
```java
User u = new User("Alice", 30, "a@b.com");
```

Or use a builder for very wide records.

---

## Optimization 10 — Records as DTOs at API boundary

**Before:** custom hand-written DTO classes for each endpoint.

**After:**
```java
public record CreateUserRequest(String name, int age) { }
public record CreateUserResponse(long id, Instant createdAt) { }
```

Fewer lines, automatic Jackson support, type-safe.

---

## Optimization 11 — Records with lazy fields

For computed values:

```java
public record CachedHash(String key, byte[] data) {
    private static final ConcurrentHashMap<CachedHash, String> CACHE = new ConcurrentHashMap<>();

    public String hash() {
        return CACHE.computeIfAbsent(this, k -> compute(k));
    }
    private static String compute(CachedHash k) { /* expensive */ }
}
```

The cached hash is per-record-content. Records are perfect map keys.

---

## Optimization 12 — Avoid records for huge component lists

If you have a record with 30+ components, the canonical constructor becomes unwieldy. Two options:

**Split** into multiple smaller records:
```java
record User(Identity id, Profile profile, Settings settings) { }
record Identity(long userId, String username) { }
record Profile(String name, int age, String email) { }
record Settings(boolean notifications, String theme) { }
```

**Use a Builder + record at the bottom**:
```java
record User(...) { }
public class User.Builder { /* setters returning this */; public User build() { ... } }
```

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintEliminateAllocations`              | EA decisions on record allocation       |
| `-XX:+PrintInlining`                          | Inlining of accessors                  |
| `jol-cli`                                     | Record memory layout                   |
| `jmh`                                         | Benchmark record vs class               |
| Jackson + records                             | JSON binding test                      |

---

**Memorize this**: records are almost always faster and clearer than equivalent POJOs. The JIT inlines accessors and eliminates short-lived records via EA. Use them as DTOs, value types, sealed-type variants, and map keys. Avoid them only when mutation, inheritance, or huge field counts are essential.
