# Abstraction — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of an abstraction problem.

---

## Bug 1 — Returning the implementation

```java
public ArrayList<User> findActive() {
    ArrayList<User> result = new ArrayList<>();
    // ...
    return result;
}
```

**Why?** Callers now depend on `ArrayList`-specific methods (e.g., `ensureCapacity`). Changing to `LinkedList` or `List.of(...)` breaks them.

**Fix:** declare the return type as the most general useful type:

```java
public List<User> findActive() { ... }
```

---

## Bug 2 — Anemic interface

```java
public interface User {
    String name();
    int age();
    LocalDate birthday();
}
public class UserImpl implements User { /* fields, getters */ }
```

**Why?** `User` has no behavior; it's just data dressed as an abstraction. The `Impl` suffix is a smell.

**Fix:** use a record:

```java
public record User(String name, int age, LocalDate birthday) { }
```

---

## Bug 3 — Single-impl interface

```java
public interface UserService {
    User findById(long id);
}
public class UserServiceImpl implements UserService { ... }
// no other impls anywhere
```

**Why?** Premature abstraction; the interface adds no value, only ceremony.

**Fix:** collapse to a class:

```java
public class UserService {
    public User findById(long id) { ... }
}
```

(If you need to mock for tests, modern mocking libraries can mock concrete classes.)

---

## Bug 4 — Leaking abstraction via exception

```java
public interface Cache<K, V> {
    V get(K key);
}

public class JdbcCache implements Cache<String, byte[]> {
    @Override public byte[] get(String key) {
        try {
            return loadFromDb(key);
        } catch (SQLException e) {
            throw new RuntimeException(e);   // leaks JDBC concern
        }
    }
}
```

**Why?** Callers see a generic `RuntimeException` wrapping `SQLException`. The abstraction (`Cache`) leaks its impl. Worse, callers can't distinguish "key absent" from "DB connection lost."

**Fix:** define the abstraction's exception hierarchy and translate:

```java
public class CacheException extends RuntimeException { ... }
// ...
throw new CacheException("backend error", e);
```

Even better: return `Optional<V>` for absence and throw `CacheException` only for genuine failures.

---

## Bug 5 — Abstract class with no abstract methods

```java
public abstract class Helper {
    public static String join(String... parts) { ... }
}
```

**Why?** Nothing is abstract. The `abstract` modifier just prevents instantiation. Awkward.

**Fix:** make it a regular class with a private constructor (utility class), or move statics to an `interface`:

```java
public final class Helper {
    private Helper() {}
    public static String join(String... parts) { ... }
}
```

---

## Bug 6 — Overridable in constructor (template-method trap)

```java
public abstract class Loader {
    public Loader() {
        load();
    }
    protected abstract void load();
}

class CSVLoader extends Loader {
    private final String separator = ",";
    @Override protected void load() {
        System.out.println("sep=" + separator);
    }
}
```

**Why?** When `CSVLoader` is constructed, `Loader.<init>` runs first and calls `load()`. Polymorphism dispatches to `CSVLoader.load()`, but `separator` hasn't been initialized — prints "sep=null."

**Fix:** don't call abstract methods from the constructor. Use a static factory:

```java
public static <L extends Loader> L create(Supplier<L> ctor) {
    L l = ctor.get();
    l.load();
    return l;
}
```

---

## Bug 7 — `default` defeats exhaustiveness

```java
sealed interface Shape permits Circle, Square { }

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
        default -> 0;
    };
}
```

**Why?** Adding a `Triangle` to permits won't break the switch — `default` swallows it.

**Fix:** remove `default`. Let the compiler force you to update every switch when the hierarchy changes.

---

## Bug 8 — Two interfaces, conflicting defaults

```java
interface X { default String hello() { return "X"; } }
interface Y { default String hello() { return "Y"; } }

class Z implements X, Y { }
```

**Why?** Compile error: "class Z inherits unrelated defaults for hello()."

**Fix:** override and disambiguate:

```java
class Z implements X, Y {
    @Override public String hello() {
        return X.super.hello() + " " + Y.super.hello();
    }
}
```

---

## Bug 9 — Marker interface as abstraction

```java
public interface Sortable { }     // no methods

public class Sorter {
    public static void sort(List<? extends Sortable> list) {
        list.sort((a, b) -> ???);   // can't actually sort — no compareTo!
    }
}
```

**Why?** `Sortable` declares no contract. Implementing it doesn't actually convey any behavior to the sorter.

**Fix:** use `Comparable` (or `Comparator`):

```java
public static <T extends Comparable<T>> void sort(List<T> list) {
    list.sort(Comparator.naturalOrder());
}
```

---

## Bug 10 — Hidden mutability via abstract type

```java
public interface UserList {
    List<User> users();
}

public class UserListImpl implements UserList {
    private final List<User> users = new ArrayList<>();
    public List<User> users() { return users; }   // (!) leak
}
```

**Why?** Callers can mutate the internal list (`userList.users().clear()`) because the returned `List` is mutable.

**Fix:** return an unmodifiable view, or copy:

```java
public List<User> users() { return List.copyOf(users); }
// or
public List<User> users() { return Collections.unmodifiableList(users); }
```

Better: return `Stream<User>` or specific iteration methods.

---

## Bug 11 — Interface with too many methods

```java
public interface UserManager {
    User create(NewUser nu);
    void delete(long id);
    User findById(long id);
    List<User> search(SearchCriteria c);
    void importFromCsv(InputStream is);
    String exportToJson();
    void sendNotification(long id, String message);
    Statistics getStats();
}
```

**Why?** Forces every implementer to know about CSV, JSON, notifications, stats. Mocking is huge. Violates Interface Segregation Principle.

**Fix:** split by role:

```java
interface UserRepository { User create(NewUser); void delete(long); User findById(long); List<User> search(SearchCriteria); }
interface UserImporter { void importFromCsv(InputStream); }
interface UserExporter { String exportToJson(); }
interface UserNotifier { void sendNotification(long, String); }
interface UserStatistics { Statistics getStats(); }
```

Compose them where needed.

---

## Bug 12 — `clone()` masquerading as abstraction

```java
class Polygon implements Cloneable {
    List<Point> points = new ArrayList<>();
    @Override
    public Polygon clone() {
        try { return (Polygon) super.clone(); } catch (CloneNotSupportedException e) { throw new AssertionError(); }
    }
}
```

**Why?** `Cloneable` is a marker interface with no methods. The contract of `clone()` is convoluted (shallow copy by default; subclasses can override). The `points` list is shared between original and clone.

**Fix:** use a copy constructor or static `copy` method:

```java
class Polygon {
    final List<Point> points;
    Polygon(List<Point> points) { this.points = List.copyOf(points); }
    Polygon(Polygon other) { this(other.points); }
}
```

---

## Pattern recap

| Bug | Family                                  | Cure                          |
|-----|-----------------------------------------|-------------------------------|
| 1   | Return concrete impl from public API    | Return abstraction             |
| 2   | Anemic interface                         | Use a record                   |
| 3   | Single-impl interface                    | Collapse                       |
| 4   | Leaky exception in abstraction           | Translate at boundary          |
| 5   | abstract class with no abstract methods  | Make it a final utility        |
| 6   | Overridable in ctor                      | Static factory                 |
| 7   | `default` defeats exhaustiveness         | Remove `default`               |
| 8   | Default-method diamond                   | Override + super calls         |
| 9   | Marker interface with no contract        | Use a real interface           |
| 10  | Mutable collection leaked                 | `List.copyOf` / unmodifiable   |
| 11  | Fat interface                             | Split by role (ISP)            |
| 12  | `Cloneable` misuse                        | Copy constructor / factory     |

---

**Memorize the shapes**: most abstraction bugs are about *too much* (premature, overly broad) or *too little* (anemic, marker-only) abstraction, or *leaky* abstraction (impl details poke through). Use just enough.
